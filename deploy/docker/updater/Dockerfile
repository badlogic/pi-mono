FROM alpine:3.20
RUN apk add --no-cache bash git openssh-client docker-cli docker-cli-compose
COPY updater.sh /usr/local/bin/updater.sh
RUN chmod +x /usr/local/bin/updater.sh
ENTRYPOINT ["/usr/local/bin/updater.sh"]
