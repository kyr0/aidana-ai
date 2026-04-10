import asyncio
import websockets
import wave
import struct
import json
import numpy as np
from scipy.signal import resample
from pathlib import Path


REFERENCE_WAV = Path(__file__).resolve().parent / "reference.wav"

async def test():
    wav = wave.open(str(REFERENCE_WAV), "rb")
    nch = wav.getnchannels()
    sw = wav.getsampwidth()
    rate = wav.getframerate()
    nframes = wav.getnframes()
    raw = wav.readframes(nframes)
    wav.close()
    
    # Convert to float32
    if sw == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        raise ValueError(f"Unsupported sample width: {sw}")
    
    # If stereo, mix to mono
    if nch == 2:
        samples = (samples[0::2] + samples[1::2]) / 2.0
    
    # Resample to 16kHz
    target_rate = 16000
    if rate != target_rate:
        num_samples = int(len(samples) * target_rate / rate)
        samples = resample(samples, num_samples).astype(np.float32)
    
    print(f"Loaded {len(samples)} samples ({len(samples)/16000:.1f}s) from {rate}Hz {nch}ch")
    
    async with websockets.connect("ws://localhost:31337/asr") as ws:
        # Send in 4096-sample chunks
        chunk_size = 4096
        offset = 0
        chunks = 0
        while offset < len(samples):
            end = min(offset + chunk_size, len(samples))
            chunk = samples[offset:end]
            await ws.send(chunk.tobytes())
            chunks += 1
            offset = end
            await asyncio.sleep(0.01)
        
        print(f"Sent {chunks} chunks, flushing...")
        await ws.send(json.dumps({"flush": True}))
        
        # Receive results
        while True:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=60)
                data = json.loads(msg)
                tag = "DONE" if data.get("done") else ("CONFIRMED" if data.get("confirmed") else "PARTIAL")
                print(f"{tag}: {data.get('text','')}")
                if data.get("done"):
                    break
            except asyncio.TimeoutError:
                print("Timeout waiting for response")
                break

asyncio.run(test())