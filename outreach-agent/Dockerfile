FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY mcp_server ./mcp_server
COPY agent ./agent
COPY memory ./memory
COPY eval ./eval
EXPOSE 8000
CMD ["uvicorn", "agent.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
