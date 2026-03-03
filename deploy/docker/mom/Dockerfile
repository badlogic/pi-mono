FROM node:20-alpine
RUN apk add --no-cache bash git

WORKDIR /repo

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sh","-lc","node -v && sleep infinity"]
