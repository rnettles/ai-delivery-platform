# execution-service-phase1.md

## Phase 1 — Prove the Execution Service Works In Isolation

---

## 🎯 Goal

Deploy a **minimal, working Execution Service API** that can:

* Respond to health checks
* Accept execution requests
* Return deterministic responses

No database, no storage, no external dependencies.

---

## 📡 Required Endpoints

### 1. Health Check

**GET `/health`**

#### Response

```json
{
  "status": "ok"
}
```

---

### 2. Execute Endpoint

**POST `/execute`**

#### Request

```json
{
  "execution_id": "test-1",
  "script": "test.echo",
  "input": { "message": "hello" }
}
```

#### Response

```json
{
  "execution_id": "test-1",
  "status": "completed",
  "output": {
    "message": "hello"
  }
}
```

---

## 🧪 Minimal Implementation (Single File)

Use this to validate quickly before introducing structure.

### `server.ts`

```ts
import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Execute endpoint
app.post("/execute", (req, res) => {
  const { execution_id, script, input } = req.body;

  if (!script) {
    return res.status(400).json({
      error: "script is required"
    });
  }

  // Minimal behavior: echo input
  if (script === "test.echo") {
    return res.status(200).json({
      execution_id: execution_id || "generated-id",
      status: "completed",
      output: input
    });
  }

  return res.status(404).json({
    error: `Unknown script: ${script}`
  });
});

app.listen(PORT, () => {
  console.log(`Execution service running on port ${PORT}`);
});
```

---

## 🐳 Minimal Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
```

---

## ▶️ Run Locally

```bash
npm install
npx tsx server.ts
```

---

## 🔍 Test Locally

### Health

```bash
curl http://localhost:3000/health
```

---

### Execute

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "execution_id": "test-1",
    "script": "test.echo",
    "input": { "message": "hello" }
  }'
```

---

## 🚀 Deploy to Azure (Container Apps)

1. Build image:

```bash
docker build -t isdevcr.azurecr.io/execution-service:phase1 .
```

2. Push:

```bash
docker push isdevcr.azurecr.io/execution-service:phase1
docker buildx build --platform linux/amd64 -t isdevcr.azurecr.io/execution-service:phase1 --push .
```

3. Update Terraform image tag (or override):

```
execution-service:phase1
```

4. Apply Terraform:

```bash
terraform apply
```

---

## 🌐 Validate Deployment

```bash
curl https://<execution-service-url>/health
```

```bash
curl -X POST https://<execution-service-url>/execute \
  -H "Content-Type: application/json" \
  -d '{
    "execution_id": "test-1",
    "script": "test.echo",
    "input": { "message": "hello" }
  }'
```

---

## ✅ Success Criteria

You are done with Phase 1 when:

* `/health` returns `200 OK`
* `/execute` returns expected JSON
* Container runs successfully in Azure
* No dependency on database or storage

---

## ⛔ Do NOT Add Yet

* Script registry
* Database
* Blob storage
* Authentication
* n8n integration

---

## ➡️ Next Step

Proceed to:

**Phase 2 — Connect n8n → Execution Service**
