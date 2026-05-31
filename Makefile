SHELL_SCRIPTS := $(wildcard scripts/*.sh)

.PHONY: lint validate

lint:
	shellcheck $(SHELL_SCRIPTS)

validate: lint
	scripts/check-prereqs.sh
