# Kubernetes Deployment for Linda Assistant

Deploys the Linda Assistant backend (Next.js API server + worker) with RabbitMQ to Kubernetes.

## Architecture

- **linda-frontend** — Next.js API server (port 3000)
- **linda-worker** — Bun worker consuming tasks from RabbitMQ (health port 3002)
- **rabbitmq** — Message broker with persistent storage

External services (not deployed here): Turso (DB), Upstash Redis, Resend (email), S3.

## Files

| File | Purpose |
|------|---------|
| `namespace.yaml` | `linda` namespace |
| `configmap.yaml` | Non-secret config (RabbitMQ URL) |
| `secrets.yaml` | Secret template (placeholder values) |
| `frontend-deployment.yaml` | Next.js deployment with health checks |
| `frontend-service.yaml` | ClusterIP for Next.js |
| `worker-deployment.yaml` | Worker deployment with health checks |
| `rabbitmq-deployment.yaml` | RabbitMQ pod + 1Gi PVC |
| `rabbitmq-service.yaml` | ClusterIP for RabbitMQ |
| `ingress.yaml` | NGINX ingress for `linda.rxlab.app` |
| `cluster-issuer.yaml` | Let's Encrypt TLS issuer |
| `kustomization.yaml` | Kustomize orchestration |

## Prerequisites

1. Kubernetes cluster with `kubectl` access
2. NGINX Ingress Controller
3. cert-manager (for TLS)

## Setup

### 1. Populate Secrets

Edit `secrets.yaml` with real values, then apply:

```bash
kubectl apply -f secrets.yaml
```

### 2. Deploy

```bash
kubectl apply -k .
```

### 3. Verify

```bash
kubectl get pods -n linda
kubectl get services -n linda
kubectl get ingress -n linda
```

## Health Checks

| Component | Endpoint | Port |
|-----------|----------|------|
| Frontend | `/api/health` | 3000 |
| Worker | `/healthz` | 3002 |
| RabbitMQ | `rabbitmq-diagnostics check_running` | — |

## CI/CD

The GitHub Actions workflow (`release.yml`) automatically:
1. Builds Docker images on every push (test only, no push)
2. On release: pushes images to GHCR and deploys to K8s

Required GitHub Secret: `K8S_CONFIG_FILE_B64` (base64-encoded kubeconfig)
