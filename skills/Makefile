SKILLS := instrument-obs-unified investigate-obs-unified

.PHONY: build validate lint clean messaging-check howto-sync-check

build:
	@mkdir -p dist
	@for skill in $(SKILLS); do \
		scripts/package.sh $$skill; \
	done

validate: messaging-check howto-sync-check
	@for skill in $(SKILLS); do \
		scripts/validate.sh $$skill; \
	done

# RFC 0012 messaging parity: SKILL.md files vs vendored messaging.manifest.json
messaging-check:
	node scripts/messaging-check.mjs

# Skill reference copy must match docs/howto (links rewritten to absolute URLs)
howto-sync-check:
	scripts/howto-sync.sh --check

lint:
	shellcheck scripts/*.sh

clean:
	@rm -rf dist
