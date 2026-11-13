import asyncio, json, sys, edge_tts
# say.py <name> <voice> <rate> <text>: writes <name>.mp3 and <name>.json (word boundaries, seconds)
name, voice, rate, text = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
async def run():
    import os
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary", proxy=os.environ.get("HTTPS_PROXY"))
    words = []
    with open(f"{name}.mp3", "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] == "WordBoundary": words.append({"w": ch["text"], "t0": ch["offset"] / 1e7, "t1": (ch["offset"] + ch["duration"]) / 1e7})
    json.dump(words, open(f"{name}.json", "w"))
    print(name, len(words), "words", f"{words[-1]['t1']:.2f}s" if words else "")
asyncio.run(run())
