FROM docker.io/cloudflare/sandbox:0.12.8

# Repository investigations use ripgrep for fast, bounded source search.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ripgrep \
  && rm -rf /var/lib/apt/lists/*
