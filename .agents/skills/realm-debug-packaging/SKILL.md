---
name: realm-debug-packaging
description: RealmのTauri 2によるApple Silicon macOS .app・DMG、bundle metadata、arm64実行file、resource、checksum、SBOM・notices、起動smokeの構成変更と障害を扱う。配布build失敗、成果物欠落、不要file混入、package検査に使い、tag・Releaseはrealm-releaseを優先する。
---

# Realm Packaging Debug

1. 調査だけなら成果物を作り直さず、OS、command、最初の失敗を特定する。
2. package、Tauri config、build・check・smoke・asset script、release docsを読む。
3. web build、Rust、Tauri bundle、DMG、metadata、smoke、release-assetsを分けて再現する。
4. macOS arm64以外を作らず、古い成果物を現行sourceの成功証拠にしない。
5. identifier、version、minimum OS、document association、arm64 executableを確認する。
6. license、notices、SBOM、checksumを確認し、source、test、map dataを含めない。
7. 未署名・未公証を現行方針とし、資格情報を推測で追加しない。
8. package起動はrelease gateまたは明示依頼だけで行う。
