# Third-party services

BeepBite's supported deployment uses AWS serverless infrastructure. The AWS
account hosting an environment stores and processes its application data. The
development deployment is in `us-east-1`; operators deploying another
environment should confirm the region and AWS terms that apply to it.

---

## Optional integrations

| Service | Enabled by | What leaves your server | If you skip it |
|---|---|---|---|
| **Amazon Web Services** | Required for the hosted application | Application records and requests are processed by API Gateway, Lambda and DynamoDB; files may use S3 and delivery uses CloudFront | The application cannot run without its AWS stack |
| **Meta (WhatsApp Business API)** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Customer phone number, order summary, chat messages | No WhatsApp ordering channel. QR / web ordering still works. |
| **SMTP server of your choice** | `SMTP_HOST` and friends | Email address, name, receipt and invite contents | No transactional email. Everything else works. |
| **SendGrid / Mailgun / Amazon SES** | `EMAIL_PROVIDER_DEFAULT` | Same as above | Use plain SMTP instead — it is the default. |
| **Mapbox** | `MAPBOX_TOKEN` | Delivery addresses being geocoded | The chatbot asks customers to share a location pin instead of typing an address. |
| **Google (Gemini)** | `GEMINI_API_KEY` | Floor-plan descriptions, menu text you paste in, owner-assistant prompts | No AI floor-plan generator and no owner assistant. |

The WhatsApp credentials are **yours**, registered under your own Meta Business
account. BeepBite never holds them and there is no shared account.

## What is deliberately not here

- **No payment processor.** BeepBite records tenders and never touches a card.
  See [Payments](help/payments.md).
- **No payment processor.** BeepBite records tenders and never touches a card.
- **No third-party identity provider is required.** Sign-in is managed by the
  BeepBite API; secrets are held in AWS Secrets Manager.

## Your obligations

Operators are responsible for their privacy notices, access policies,
retention and data-residency choices. Review AWS and any optional service's
terms for the account and region where the environment is deployed.
