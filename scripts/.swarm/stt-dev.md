# stt-dev progress

- [x] Verified venv (faster_whisper 1.2.1) and assets/sam-hello-v2.mp3 exist
- [x] dev-server.mjs: listen(PORT, "127.0.0.1"), defaults -> qwen2.5:7b-instruct, /api/stt route (HEAD probe 200/501, POST raw body -> os.tmpdir temp file -> venv python -c faster_whisper base/cpu/int8, 30s execFile timeout, temp unlinked)
- [x] sam-stt.js: window.SamSTT {available() cached HEAD check, record({maxMs}) MediaRecorder audio/webm, 6s default max, promise.stop(), POSTs blob to /api/stt}
- [x] receptionist.html: sam-stt.js script tag added directly before desk.js
- [x] node --check dev-server.mjs + sam-stt.js: OK
- [x] silence wav (2s anullsrc) transcript: "You" (near-empty; classic whisper silence hallucination — fine)
- [x] sam-hello-v2.mp3 transcript: "Hello, welcome to Company AI Architect. I am Sam..." — contains 'Company AI Architect' PASS
- Not done: no server restart (per orders), no commit/deploy, index.html untouched
