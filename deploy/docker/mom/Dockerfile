FROM node:20-alpine
RUN apk add --no-cache bash git

WORKDIR /repo

COPY entrypoint.sh /usr/local/bin/mom-entrypoint.sh
RUN chmod +x /usr/local/bin/mom-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/mom-entrypoint.sh"]
