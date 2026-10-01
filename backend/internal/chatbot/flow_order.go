package chatbot

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/beepbite/backend/internal/channel"
)

// shouldOpenOrderFlow is deliberately conservative. The native form is an
// entry point from the main menu, not a replacement for an in-progress text
// conversation where a customer may be answering an address or payment
// question.
func (s *Service) shouldOpenOrderFlow(state ConversationState, body string) bool {
	if s.orderFlowID == "" || state.Step != "main_menu" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(body)) {
	case "a", "order", "make order", "make new order", "new order", "pedir", "nuevo pedido", "hacer pedido":
		return true
	default:
		return false
	}
}

func (s *Service) sendOrderFlow(ctx context.Context, to, chatID string) {
	if s.ch == nil {
		return
	}
	message := channel.Message{
		To:   to,
		Body: "Elegí tus productos y completá los datos del pedido.",
		Flow: &channel.FlowMessage{
			ID:      s.orderFlowID,
			Token:   fmt.Sprintf("order-%s-%d", to, time.Now().UnixNano()),
			CTA:     nonEmptyOr(s.orderFlowCTA, "Hacer pedido"),
			Screen:  s.orderFlowScreen,
			Version: "3",
			Data:    map[string]any{"phone": to},
		},
	}
	if _, err := s.ch.Send(ctx, message); err != nil {
		log.Printf("chatbot: sending order Flow failed: %v", err)
		// The text conversation is still available if Meta rejects the Flow.
		fallback := "No pude abrir el formulario de pedido. Respondé *1* para continuar con el pedido por chat."
		s.sendResponse(ctx, to, fallback, chatID)
		return
	}
	s.saveMessage(ctx, chatID, "", "outbound", message.Body)
	s.updateChatLastMessage(ctx, chatID, message.Body)
}

func nonEmptyOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

type flowOrderItem struct {
	ID                  string
	Quantity            int
	SpecialInstructions string
}

type flowOrderResponse struct {
	Screen string
	Data   map[string]any
}

// ProcessFlowResponse consumes the nfm_reply/flow_reply response sent by Meta
// after a customer submits the native form. It intentionally writes through
// cart_items and createOrder, so WhatsApp and POS share pricing, tax, currency,
// inventory and kitchen behavior.
func (s *Service) ProcessFlowResponse(ctx context.Context, phoneNumberID, from, messageID, responseJSON, displayName string) error {
	normalizedFrom := strings.TrimPrefix(from, "+")
	bot := s.getBotFromPhoneNumber(ctx, phoneNumberID)
	if bot == nil || bot.ID != SystemBotID {
		return nil
	}

	var response flowOrderResponse
	if err := json.Unmarshal([]byte(responseJSON), &response); err != nil {
		return fmt.Errorf("whatsapp flow response: %w", err)
	}
	if response.Data == nil {
		response.Data = map[string]any{}
	}

	customer := s.getOrCreateCustomer(ctx, normalizedFrom, displayName)
	if customer == nil {
		return fmt.Errorf("create flow customer")
	}
	chat := s.getOrCreateChat(ctx, customer.ID, "")
	if chat == nil {
		return fmt.Errorf("create flow chat")
	}
	s.saveMessage(ctx, chat.ID, messageID, "inbound", responseJSON)

	locationID := firstFlowString(response.Data, "location_id", "store_id", "location")
	if locationID == "" {
		return s.replyFlowError(ctx, normalizedFrom, chat.ID, "Falta seleccionar el local. Abrí el formulario nuevamente.")
	}
	var active bool
	if err := s.pool.QueryRow(ctx, `SELECT is_active FROM locations WHERE id = $1`, locationID).Scan(&active); err != nil || !active {
		return s.replyFlowError(ctx, normalizedFrom, chat.ID, "Ese local ya no está disponible. Elegí otro local.")
	}

	items := parseFlowItems(response.Data)
	if len(items) == 0 {
		return s.replyFlowError(ctx, normalizedFrom, chat.ID, "No recibí productos en el pedido. Volvé a intentarlo.")
	}
	for _, item := range items {
		if item.ID == "" || item.Quantity < 1 || item.Quantity > 99 {
			return s.replyFlowError(ctx, normalizedFrom, chat.ID, "Hay un producto inválido en el pedido. Volvé a intentarlo.")
		}
		var allowed bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM items WHERE id = $1 AND location_id = $2 AND is_active = true AND is_86ed = false)`,
			item.ID, locationID).Scan(&allowed); err != nil || !allowed {
			return s.replyFlowError(ctx, normalizedFrom, chat.ID, "Uno de los productos ya no está disponible. Volvé a intentarlo.")
		}
	}

	// A new native-form submission is a new basket. This avoids silently
	// combining a previous abandoned chat cart with the submitted form.
	s.clearCart(ctx, customer.ID, locationID)
	for _, item := range items {
		if !s.addToCart(ctx, customer.ID, locationID, item.ID, item.Quantity, nil, item.SpecialInstructions) {
			s.clearCart(ctx, customer.ID, locationID)
			return s.replyFlowError(ctx, normalizedFrom, chat.ID, "No pude guardar todos los productos. Volvé a intentarlo.")
		}
	}

	orderType := strings.ToLower(firstFlowString(response.Data, "order_type", "fulfillment_type", "delivery_type"))
	if orderType == "dine_in" || orderType == "dine-in" || orderType == "local" || orderType == "comer_en_local" || orderType == "salon" || orderType == "salón" {
		orderType = "dine_in"
	} else if orderType == "collection" || orderType == "takeaway" || orderType == "pickup" || orderType == "para_llevar" {
		orderType = "pickup"
	} else if orderType == "delivery" {
		orderType = "delivery"
	} else {
		s.clearCart(ctx, customer.ID, locationID)
		return s.replyFlowError(ctx, normalizedFrom, chat.ID, "Falta indicar si el pedido es para llevar, comer en el local o delivery.")
	}

	var addressData *orderAddressData
	if orderType == "delivery" {
		address := firstFlowString(response.Data, "address", "delivery_address", "address_line_1")
		lat, hasLat := firstFlowFloat(response.Data, "latitude", "lat")
		lng, hasLng := firstFlowFloat(response.Data, "longitude", "lng", "lon")
		if address == "" && (!hasLat || !hasLng) {
			s.clearCart(ctx, customer.ID, locationID)
			return s.replyFlowError(ctx, normalizedFrom, chat.ID, "Falta la dirección de entrega. Volvé a completar el formulario.")
		}
		var latPtr, lngPtr *float64
		if hasLat {
			latPtr = &lat
		}
		if hasLng {
			lngPtr = &lng
		}
		instructions := firstFlowString(response.Data, "instructions", "delivery_instructions")
		var instructionsPtr *string
		if instructions != "" {
			instructionsPtr = &instructions
		}
		addressData = &orderAddressData{Address: address, Latitude: latPtr, Longitude: lngPtr, Instructions: instructionsPtr}
	}

	result := s.createOrder(ctx, customer.ID, locationID, orderType, addressData, 0, firstFlowString(response.Data, "email", "customer_email"))
	if !result.Success {
		return s.replyFlowError(ctx, normalizedFrom, chat.ID, "No pude crear el pedido. Revisá los datos e intentá nuevamente.")
	}
	s.updateConversationState(ctx, chat.ID, ConversationState{Step: "main_menu"})
	s.sendResponse(ctx, normalizedFrom, formatOrderConfirmation(result.OrderNumber, 30), chat.ID)
	return nil
}

func (s *Service) replyFlowError(ctx context.Context, to, chatID, message string) error {
	s.sendResponse(ctx, to, message, chatID)
	return nil
}

func parseFlowItems(data map[string]any) []flowOrderItem {
	raw, ok := data["items"].([]any)
	if !ok {
		raw, ok = data["cart"].([]any)
	}
	if !ok {
		return nil
	}
	items := make([]flowOrderItem, 0, len(raw))
	for _, value := range raw {
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		quantity := 0
		if number, ok := entry["quantity"].(float64); ok {
			quantity = int(number)
		} else if text, ok := entry["quantity"].(string); ok {
			quantity, _ = strconv.Atoi(text)
		}
		items = append(items, flowOrderItem{
			ID:                  firstFlowString(entry, "item_id", "id", "product_id"),
			Quantity:            quantity,
			SpecialInstructions: firstFlowString(entry, "special_instructions", "notes"),
		})
	}
	return items
}

func firstFlowString(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := data[key]; ok {
			switch typed := value.(type) {
			case string:
				if strings.TrimSpace(typed) != "" {
					return strings.TrimSpace(typed)
				}
			case float64:
				return strconv.FormatFloat(typed, 'f', -1, 64)
			}
		}
	}
	return ""
}

func firstFlowFloat(data map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		value, ok := data[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed, true
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
			if err == nil {
				return parsed, true
			}
		}
	}
	return 0, false
}
