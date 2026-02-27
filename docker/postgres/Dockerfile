# PostgreSQL 17 with Apache AGE (graph queries) and pgmq (message queue)
# Build: docker build -t fugue-postgres ./docker/postgres
FROM postgres:17

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
	build-essential \
	git \
	postgresql-server-dev-17 \
	curl \
	ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Install pgmq from trunk (Tembo's extension registry)
# pgmq is MIT licensed: https://github.com/tembo-io/pgmq
RUN curl -s https://install.pgxman.com/pgmq.sh | bash -s -- postgresql-17 \
	|| (echo "pgxman failed, trying cargo-pgx method" && exit 1)

# Alternative: compile pgmq from source if pgxman unavailable
RUN git clone --depth=1 --branch v1.5.0 https://github.com/tembo-io/pgmq /tmp/pgmq 2>/dev/null || true && \
	if [ -d /tmp/pgmq ]; then \
		cd /tmp/pgmq && \
		apt-get update && apt-get install -y --no-install-recommends libpq-dev curl && \
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable && \
		export PATH="$HOME/.cargo/bin:$PATH" && \
		cargo install cargo-pgrx --version 0.12.0 && \
		cargo pgrx init --pg17 $(which pg_config) && \
		cargo pgrx install --pg-config $(which pg_config) 2>/dev/null || true; \
	fi

# Install Apache AGE (graph extension)
# AGE is Apache 2.0 licensed: https://github.com/apache/age
RUN git clone --depth=1 --branch PG17/v1.5.0 https://github.com/apache/age /tmp/age && \
	cd /tmp/age && \
	make install PG_CONFIG=$(which pg_config) && \
	rm -rf /tmp/age

# Enable extensions in postgresql.conf
RUN echo "shared_preload_libraries = 'age'" >> /usr/share/postgresql/postgresql.conf.sample

# Initialization script
COPY init.sql /docker-entrypoint-initdb.d/init.sql
