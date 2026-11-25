# Deployment (C18): prepared, NOT run

Nothing here has been deployed. It needs your AWS account, a `.xyz` domain with DNS access, and your go-ahead (it costs money).

## Option A: one EC2 box with Docker Compose (recommended for the hackathon)
1. Launch an EC2 instance: Ubuntu 24.04, `t3.large` (Chromium needs RAM), 30 GB disk; security group open on 22, 80, 443.
2. DNS: A-records for `api`, `mcp`, `app`, `voice`, `scholarship`, `fees`, `buspass` (or a wildcard `*`) → the instance's public IP.
3. On the box:
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
   git clone https://github.com/RohanNK86/Khaos.git && cd Khaos
   cp .env.example .env   # set DOMAIN=yourdomain.xyz, POSTGRES_PASSWORD, LAB_TOKEN, LLM keys
   sudo docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
   ```
4. Check: `https://api.<domain>/health`, `https://mcp.<domain>/mcp` (MCP Inspector), `https://app.<domain>`.
5. Put `PUBLIC_MCP_URL=https://mcp.<domain>/mcp` into `.env` and into the ElevenLabs agent (apps/voice/README.md).

Notes:
- Portals 2/3 and the dashboard must use public URLs: set `API_URL=https://api.<domain>` (portals embed `mcpify.js` from it).
- Change `LAB_TOKEN` from `changeme` in production; the Layout Lab hooks are protected by it.
- Runs are headless in production (`HEADLESS=1`); the live view at `https://mcp.<domain>/` still shows every step.

## Option B: quick public URL from your laptop (no AWS)
`brew install cloudflared` then `cloudflared tunnel --url http://localhost:4100` → use the printed `https://….trycloudflare.com/mcp` as `PUBLIC_MCP_URL`. (On hold until you approve installing cloudflared.)

## AWS services used later
- **Bedrock**: Claude Haiku 5.5 (`LLM_PROVIDER=bedrock`, `AWS_REGION`, model access enabled in the console).
- **KMS**: asymmetric signing key for receipts (`SIGNER=kms`, `KMS_KEY_ID`), about $1/month.
- **S3**: blob storage (`S3_BUCKET`) instead of the local `.data/blobs`.
- **Amplify** (optional): host the dashboard instead of the box.
