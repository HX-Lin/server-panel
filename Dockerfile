FROM golang:1.24-alpine AS builder

WORKDIR /src

RUN apk add --no-cache build-base

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go mod tidy && go build -o /out/server-panel .

FROM alpine:3.21

WORKDIR /app

RUN apk add --no-cache ca-certificates openssh-client tzdata \
    && mkdir -p /app/config /app/data /root/.ssh

COPY --from=builder /out/server-panel /usr/local/bin/server-panel

ENV TZ=Asia/Shanghai
ENV SERVER_PANEL_CONFIG=/app/config/config.json

EXPOSE 8787

CMD ["server-panel", "panel", "--config", "/app/config/config.json"]
