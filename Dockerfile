# Runs the AgentPayGuard dApp on any machine, no Node install needed.
#   docker build -t agentpayguard .
#   docker run --rm -p 8080:80 agentpayguard
# Then open http://localhost:8080 and connect a wallet pointed at QDay Aevum
# (chain 44005). The dApp is static and talks to the chain directly, so the
# container only serves files.
FROM python:3.12-alpine

WORKDIR /app
COPY dashboard/ /app/

EXPOSE 80
CMD ["python", "-m", "http.server", "80", "--bind", "0.0.0.0", "--directory", "/app"]
