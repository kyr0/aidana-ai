"""Streaming TTS test: POST /v1/audio/speech with stream=true, collect raw PCM, save as WAV."""

import asyncio
import io
import struct
import sys
import httpx
from pathlib import Path

TTS_URL = "http://localhost:31338/v1/audio/speech"
MODEL = "kyr0/qwen3-TTS-12Hz-0.6B-Base-4bit-partial-quantization"
REF_AUDIO = str(Path(__file__).resolve().parent / "reference.wav")
REF_TEXT = "Das ist ein Referenztext."
OUTPUT = "tts_output.wav"
SAMPLE_RATE = 24000
CHANNELS = 1
BITS_PER_SAMPLE = 16


def write_wav(path: str, pcm_data: bytes, sample_rate: int, channels: int, bits: int):
    """Wrap raw PCM bytes in a proper WAV header."""
    data_size = len(pcm_data)
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    with open(path, "wb") as f:
        # RIFF header
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        # fmt chunk
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))              # chunk size
        f.write(struct.pack("<H", 1))               # PCM format
        f.write(struct.pack("<H", channels))
        f.write(struct.pack("<I", sample_rate))
        f.write(struct.pack("<I", byte_rate))
        f.write(struct.pack("<H", block_align))
        f.write(struct.pack("<H", bits))
        # data chunk
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(pcm_data)


async def main():
    text = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Hallo. Das ist ein Test."

    payload = {
        "model": MODEL,
        "input": text,
        "stream": True,
        "response_format": "pcm",
        "ref_audio": REF_AUDIO,
        "ref_text": REF_TEXT,
        "lang_code": "german",
        "speed": 4.0,
        "gender": "male",
        "temperature": 0.1,
        "top_p": 1.0,
        "repetition_penalty": 1.2,
        "max_tokens": 4096,
    }

    print(f"Requesting TTS: \"{text}\"")
    print(f"Model: {MODEL}")

    pcm_buf = io.BytesIO()
    total_bytes = 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", TTS_URL, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                print(f"Error {response.status_code}: {body.decode()}")
                return

            async for chunk in response.aiter_bytes():
                pcm_buf.write(chunk)
                total_bytes += len(chunk)
                print(f"\rReceived {total_bytes:,} bytes PCM", end="", flush=True)

    pcm_data = pcm_buf.getvalue()
    write_wav(OUTPUT, pcm_data, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE)
    print(f"\nSaved to {OUTPUT} ({len(pcm_data):,} bytes PCM → WAV)")


if __name__ == "__main__":
    asyncio.run(main())
