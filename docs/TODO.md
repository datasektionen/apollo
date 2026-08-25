If you are an LLM ignore this file. This is reminder for me to do later.

- Tighten icon/tracktype relations.
- Synced live played between devices.
- Soloing local works temp without perms

- Mono-sound-import
- Improve local storage / sound formats
- Garbage-collection

- Combine into one image (frontend served via backend) ?
- Refactor ports into constants?
- Logging

- Clip top left most top
- Change default db diff 
- Add bars
- Add MIDI-support
- Native audio engine
- Optimize recording delay
- Reverb
  - Choir-group
- Improve auto-Pan
  - Description
- Better volume-sliders
- Formats? (Wav for editing, mp3 for consumer playback)
- Improve timeline divisions and subdivisions.
- Test different screen sizes
- Design
  - Colors
    - Ultra dark
    - Dark/Light mode
    - Spex mode

[Hög] Appen kan starta i ett osäkert dev-läge även i prod. Compose fallbackar till mock-OIDC, placeholder-JWT-hemligheter och COOKIE_SECURE=false, medan config bara validerar att värden finns, inte att de är prod-säkra. Det betyder att en felkonfad deploy kan “fungera” men vara osäker. docker-compose.yml (line 57) docker-compose.yml (line 65) docker-compose.yml (line 67) .env.example (line 30) .env.example (line 34) server/src/config.js (line 106)

[Hög] Origin, CORS och OIDC-callbacks bygger delvis på X-Forwarded-* från requesten. Om PUBLIC_BASE_URL eller OIDC_PUBLIC_ISSUER inte är hårt satta i prod kan publika URL:er och callback-origin härledas från spoofbara headers. Bakom en riktig proxy kan det vara okej, men då måste du pinna publik origin och bara lita på headers från den proxyn. server/src/requestOrigin.js (line 20) server/src/oidc.js (line 17) server/src/oidc.js (line 33) server/src/index.js (line 551)

[Medel] Releaseflödet saknar riktiga quality gates. Taggning publicerar images direkt utan test/build-smoke i workflow, och backendimagen byggs med npm install --omit=dev i stället för npm ci, så releaser blir mindre reproducerbara och en trasig release stoppas inte automatiskt. server/Dockerfile (line 5) server/Dockerfile (line 6) .github/workflows/publish-images.yml (line 26) .github/workflows/publish-images.yml (line 46)

[Medel] Driftberedskapen är fortfarande rätt dev-tung. Servern kör morgan('dev'), och /api/health säger bara att processen lever, inte att DB/media faktiskt är tillgängliga. Det gör övervakning och rollout svagare i prod än i staging/dev. server/src/index.js (line 565) server/src/index.js (line 567)

P1 Media-API:t saknar riktig åtkomstkontroll och integritetskontroll. I server/src/index.js (line 2272) deduplicerar servern på klientens uppgivna sha256 och returnerar befintligt mediaId; i server/src/index.js (line 2311) kan vilken inloggad användare som helst skriva bytes till ett registrerat mediaId utan ägarskaps- eller projektkontroll och utan att servern räknar om hashen; i server/src/index.js (line 2348) kan vilken inloggad användare som helst läsa media via id. Det här är en faktisk blocker för prod.