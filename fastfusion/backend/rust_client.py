import json

import httpx


RUST_URL = "http://127.0.0.1:8001"


async def run_model(payload: dict) -> dict:
    async with httpx.AsyncClient(
        timeout=120.0
    ) as client:

        response = await client.post(
            f"{RUST_URL}/run",
            json=payload,
        )

        response.raise_for_status()

        return response.json()


async def benchmark_stream(payload: dict):
    async with httpx.AsyncClient(
        timeout=None
    ) as client:

        async with client.stream(
            "POST",
            f"{RUST_URL}/benchmark/stream",
            json=payload,
        ) as response:

            response.raise_for_status()

            async for line in response.aiter_lines():
                if not line:
                    continue

                yield json.loads(line)
