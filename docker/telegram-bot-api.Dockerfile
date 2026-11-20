FROM debian:bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates cmake g++ git gperf libssl-dev make zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# Official Bot API 10.4 source and its pinned TDLib submodule.
RUN git init && git remote add origin https://github.com/tdlib/telegram-bot-api.git \
    && git fetch --depth=1 origin 7232881b39dfcd048a0d569f1983c5184249ee05 \
    && git checkout --detach FETCH_HEAD \
    && git submodule update --init --recursive --depth=1
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/out \
    && cmake --build build --target install --parallel 2

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 libstdc++6 zlib1g \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/bin/telegram-bot-api /usr/local/bin/telegram-bot-api
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/telegram-bot-api"]
