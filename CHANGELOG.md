# Changelog

## [1.4.0](https://github.com/TheOrdinaryWow/opencode-supermemory-p/compare/v1.3.0...v1.4.0) (2026-05-25)


### Features

* **memory:** log redacted content preview and add leak regression fixtures ([43359c5](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/43359c59b45562e85acc2a5aa6eab97a484fa817))
* **session:** per-session opt-out marker and cross-module reaper ([59f3a55](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/59f3a5528881641cc9cd35763e8c398d2298b445))


### Bug Fixes

* **capture:** close compaction and message-update dedup races ([1d27818](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/1d2781834c0f85fee41636a5e4bbf4757504bb40))
* **capture:** close session-end race that double-saved on idle+deleted ([4280d06](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/4280d067c1c406438594c02e212db3e71e03bee3))
* **capture:** strip sub-agent invocation prompts before saving ([5e9e992](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/5e9e9925620abd7bad6575aaa670ae401d5c45a9))
* **signal:** drop high-false-positive adverbs from default keywords ([872bfc7](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/872bfc79d0efdd04bdcae9ae6b1a479cd813d95f))
* **signal:** match keywords as whole words and ignore code blocks ([ba40e30](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/ba40e307eef8cbc6a3ab5670eea2e7218bbb8dda))


### Documentation

* document per-session opt-out markers ([04770f9](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/04770f99e2c031484f6ff071b496fe93ab8963f8))

## [1.3.0](https://github.com/TheOrdinaryWow/opencode-supermemory-p/compare/v1.2.0...v1.3.0) (2026-05-14)


### Features

* **config:** add rawProjectName project tag strategy ([eb39f6b](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/eb39f6b26d5017adb14301fef871a710f3a30b56))
* disable plugin when .supermemoryignore is present ([108393f](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/108393f676dd7b8ae59bd873b28003ef2dc04900))
* show startup toast when .supermemoryignore disables plugin ([da0cf11](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/da0cf118ab3d113b3ff0eb74851e3ae4a473009b))

## [1.2.0](https://github.com/TheOrdinaryWow/opencode-supermemory-p/compare/v1.1.0...v1.2.0) (2026-05-14)


### Features

* **config:** describe each projectTagStrategy variant in JSON schema ([2b5d9f3](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/2b5d9f329005a9bd33285b84524947bc823c3066))


### Bug Fixes

* mark CLI templates as non-subtasks ([f817e90](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/f817e90aa422d23325f199958863a85a43636141))
* realign with upgraded supermemory and plugin SDKs ([49c44b9](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/49c44b99192c290dc77dd106b9907da23e6a1ff3))


### Code Refactoring

* strip scaffolding markers instead of dropping whole message ([a121abf](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/a121abf8fc982ecccd326c4d92046d69d1a1d821))


### Documentation

* add AGENTS.md ([7b5ef3f](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/7b5ef3ff28287532a09c34e58b9ea6cc6254783d))
* clarify strip-line capture filter and purge scope ([ac0dfec](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/ac0dfec47ce6773103fa944e21970dfdb0b04086))
* describe config schema fields ([3d690af](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/3d690afda18c5386f18bbc6efab4a39fa09f0fdf))
* restructure README ([32fde5b](https://github.com/TheOrdinaryWow/opencode-supermemory-p/commit/32fde5b8ccf1ec9b1259088aa8a6139ac52b61ca))
