cd platform
docker buildx build --platform linux/amd64 -t isdevcr.azurecr.io/execution-service:phase1 --push -f backend-api/Dockerfile .
cd ..