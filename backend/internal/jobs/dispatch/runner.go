// Package dispatch offers ready delivery orders to drivers who are online for the same organization.
package dispatch

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

const (
	tickInterval = 15 * time.Second
	reofferAfter = 5 * time.Minute
	batchSize    = 100
)

type Runner struct {
	pool *pgxpool.Pool
}

func NewRunner(pool *pgxpool.Pool) *Runner {
	return &Runner{pool: pool}
}

func (r *Runner) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("dispatch: RunOnce error: %v", err)
		}
		for {
			select {
			case <-ctx.Done():
				log.Println("dispatch: runner shutting down")
				return
			case <-ticker.C:
				if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("dispatch: RunOnce error: %v", err)
				}
			}
		}
	}()
}

func (r *Runner) RunOnce(ctx context.Context) error {
	var orderIDs []string
	if err := db.Scoped(ctx, r.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT o.id
FROM orders o
WHERE (o.fulfillment_type = 'delivery' OR o.order_type = 'delivery')
	AND o.status IN ('ready', 'out_for_delivery')
ORDER BY o.created_at ASC
LIMIT $1
`, batchSize)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			orderIDs = append(orderIDs, id)
		}
		return rows.Err()
	}); err != nil {
		return err
	}

	for _, orderID := range orderIDs {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := r.offerOrder(ctx, orderID, time.Now().UTC()); err != nil {
			log.Printf("dispatch: order=%s: %v", orderID, err)
		}
	}
	return nil
}

func (r *Runner) offerOrder(ctx context.Context, orderID string, now time.Time) error {
	return db.Scoped(ctx, r.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var orgID, status, fulfillmentType, orderType string
		err := tx.QueryRow(ctx, `
SELECT o.organization_id, o.status::text, o.fulfillment_type::text, COALESCE(o.order_type, '')
FROM orders o
WHERE o.id = $1
FOR UPDATE
`, orderID).Scan(&orgID, &status, &fulfillmentType, &orderType)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if !isDispatchableOrder(status, fulfillmentType, orderType) {
			return nil
		}

		rows, err := tx.Query(ctx, `
SELECT id, status::text, offered_at
FROM driver_assignments
WHERE order_id = $1 AND status IN ('offered', 'accepted', 'picked_up')
FOR UPDATE
`, orderID)
		if err != nil {
			return err
		}
		var offeredIDs []string
		var latestOffer time.Time
		for rows.Next() {
			var id, assignmentStatus string
			var offeredAt time.Time
			if err := rows.Scan(&id, &assignmentStatus, &offeredAt); err != nil {
				rows.Close()
				return err
			}
			if assignmentStatus == "accepted" || assignmentStatus == "picked_up" {
				rows.Close()
				return nil
			}
			offeredIDs = append(offeredIDs, id)
			if offeredAt.After(latestOffer) {
				latestOffer = offeredAt
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if len(offeredIDs) > 0 && !offerExpired(latestOffer, now) {
			return nil
		}

		driverIDs := make([]string, 0)
		driverRows, err := tx.Query(ctx, `
SELECT DISTINCT m.id
FROM organization_members m
JOIN driver_shifts s ON s.driver_member_id = m.id
WHERE m.organization_id = $1
  AND m.role = 'driver'
  AND m.archived_at IS NULL
  AND s.status = 'online'
  AND s.ended_at IS NULL
ORDER BY m.id
`, orgID)
		if err != nil {
			return err
		}
		for driverRows.Next() {
			var driverID string
			if err := driverRows.Scan(&driverID); err != nil {
				driverRows.Close()
				return err
			}
			driverIDs = append(driverIDs, driverID)
		}
		if err := driverRows.Err(); err != nil {
			driverRows.Close()
			return err
		}
		driverRows.Close()
		if len(driverIDs) == 0 {
			return nil
		}

		if len(offeredIDs) > 0 {
			if _, err := tx.Exec(ctx, `
UPDATE driver_assignments
SET status = 'canceled', canceled_reason = 'Offer expired; reoffered', updated_at = $2
WHERE id = ANY($1::uuid[]) AND status = 'offered'
`, offeredIDs, now); err != nil {
				return err
			}
		}
		for _, driverID := range driverIDs {
			if _, err := tx.Exec(ctx, `
INSERT INTO driver_assignments (order_id, driver_member_id, status, offered_at)
VALUES ($1, $2, 'offered', $3)
`, orderID, driverID, now); err != nil {
				return err
			}
		}
		return nil
	})
}

func isDispatchableOrder(status, fulfillmentType, orderType string) bool {
	isDelivery := fulfillmentType == "delivery" || orderType == "delivery"
	return isDelivery && (status == "ready" || status == "out_for_delivery")
}

func offerExpired(lastOffer, now time.Time) bool {
	return !lastOffer.After(now.Add(-reofferAfter))
}
