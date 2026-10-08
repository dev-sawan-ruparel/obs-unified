SHELL := /bin/bash
.DEFAULT_GOAL := help

DEV_DIR := .dev
LOG_DIR := $(DEV_DIR)/logs
PID_DIR := $(DEV_DIR)/pids

# Ports for each service.
COLLECTOR_PORT  := 8790
WEB_PORT        := 5173
DEMO_LOCAL_PORT := 8787

# Services managed via PID files. `make stop` and `make status` walk this list.
SERVICES := collector web demo-local

.PHONY: help \
        run stop restart status logs \
        collector web \
        demo-local \
        run-with-demo \
        demo-otel demo-otel-down demo-otel-logs demo-otel-setup \
        seed smoke clean

help:
	@printf "obs-unified dev pipelines\n\n"
	@printf "  \033[1mcore (collector + web)\033[0m\n"
	@printf "    make run          start collector (:$(COLLECTOR_PORT)) + web (:$(WEB_PORT))\n"
	@printf "    make stop         stop everything started via make\n"
	@printf "    make restart      stop + run\n"
	@printf "    make status       show what's running and which ports are bound\n"
	@printf "    make logs         tail all dev logs (ctrl-c to exit)\n"
	@printf "\n  \033[1mgranular\033[0m\n"
	@printf "    make collector    start just the collector\n"
	@printf "    make web          start just the dashboard web\n"
	@printf "\n  \033[1mdemo: local synthetic\033[0m (@obs-demo/app on :$(DEMO_LOCAL_PORT))\n"
	@printf "    make demo-local   start the local demo API\n"
	@printf "    make run-with-demo  make run + make demo-local\n"
	@printf "    make seed         run the synthetic seeder (requires run-with-demo)\n"
	@printf "\n  \033[1mdemo: upstream OTel astronomy shop\033[0m (Docker, separate lifecycle)\n"
	@printf "    make demo-otel-setup  one-time: clone upstream + install extras\n"
	@printf "    make demo-otel        docker compose up -d\n"
	@printf "    make demo-otel-down   docker compose down\n"
	@printf "    make demo-otel-logs   tail load-generator logs\n"
	@printf "\n  \033[1mother\033[0m\n"
	@printf "    make smoke        curl a single OTLP span at the collector\n"
	@printf "    make clean        stop + remove .dev/ (logs, pid files)\n"

# ---- directories -------------------------------------------------------------

$(LOG_DIR) $(PID_DIR):
	@mkdir -p $@

# ---- core lifecycle ----------------------------------------------------------

run: collector web
	@printf "\n✓ collector + web started.  \`make status\` to verify, \`make logs\` to tail.\n"
	@printf "  collector: http://localhost:$(COLLECTOR_PORT)\n"
	@printf "  dashboard: http://localhost:$(WEB_PORT)\n"

restart: stop run

stop:
	@for svc in $(SERVICES); do \
		f=$(PID_DIR)/$$svc.pid; \
		if [ -f $$f ]; then \
			pid=$$(cat $$f); \
			if kill -0 $$pid 2>/dev/null; then \
				echo "stopping $$svc (pid $$pid)"; \
				kill $$pid 2>/dev/null || true; \
			fi; \
			rm -f $$f; \
		fi; \
	done
	@# Defensive sweep — wrangler/workerd/vite children sometimes outlive their parent.
	@pkill -f 'obs-unified.*workerd'  2>/dev/null || true
	@pkill -f 'obs-unified.*wrangler' 2>/dev/null || true
	@pkill -f 'obs-unified.*vite'     2>/dev/null || true
	@echo "all stopped."

status:
	@printf "\n%-14s %-8s %s\n" SERVICE PID STATE
	@printf "%-14s %-8s %s\n" "----------" "---" "-----"
	@for svc in $(SERVICES); do \
		f=$(PID_DIR)/$$svc.pid; \
		if [ -f $$f ] && kill -0 $$(cat $$f) 2>/dev/null; then \
			printf "%-14s %-8s \033[32m%s\033[0m\n" $$svc $$(cat $$f) running; \
		else \
			printf "%-14s %-8s \033[2m%s\033[0m\n" $$svc "-" stopped; \
		fi; \
	done
	@printf "\nports:\n"
	@for p in $(COLLECTOR_PORT) $(WEB_PORT) $(DEMO_LOCAL_PORT); do \
		out=$$(lsof -iTCP:$$p -sTCP:LISTEN -P -n 2>/dev/null | tail -n +2 | awk '{print $$1, $$2}' | sort -u | head -1); \
		if [ -n "$$out" ]; then \
			printf "  :%-5s \033[32mLISTEN\033[0m  %s\n" $$p "$$out"; \
		else \
			printf "  :%-5s \033[2mfree\033[0m\n" $$p; \
		fi; \
	done
	@printf "\n"

logs: | $(LOG_DIR)
	@if ls $(LOG_DIR)/*.log >/dev/null 2>&1; then \
		tail -f $(LOG_DIR)/*.log; \
	else \
		echo "no logs yet — start something with \`make run\` first."; \
	fi

# ---- individual services -----------------------------------------------------

collector: | $(LOG_DIR) $(PID_DIR)
	@if [ -f $(PID_DIR)/collector.pid ] && kill -0 $$(cat $(PID_DIR)/collector.pid) 2>/dev/null; then \
		echo "collector already running (pid $$(cat $(PID_DIR)/collector.pid))"; \
	else \
		echo "starting collector → $(LOG_DIR)/collector.log"; \
		nohup pnpm run dev:collector >$(LOG_DIR)/collector.log 2>&1 & \
		echo $$! >$(PID_DIR)/collector.pid; \
	fi

web: | $(LOG_DIR) $(PID_DIR)
	@if [ -f $(PID_DIR)/web.pid ] && kill -0 $$(cat $(PID_DIR)/web.pid) 2>/dev/null; then \
		echo "web already running (pid $$(cat $(PID_DIR)/web.pid))"; \
	else \
		echo "starting web → $(LOG_DIR)/web.log"; \
		nohup pnpm run dev:web >$(LOG_DIR)/web.log 2>&1 & \
		echo $$! >$(PID_DIR)/web.pid; \
	fi

# ---- local synthetic demo (separate, opt-in) ---------------------------------

demo-local: | $(LOG_DIR) $(PID_DIR)
	@if [ -f $(PID_DIR)/demo-local.pid ] && kill -0 $$(cat $(PID_DIR)/demo-local.pid) 2>/dev/null; then \
		echo "demo-local already running (pid $$(cat $(PID_DIR)/demo-local.pid))"; \
	else \
		echo "starting demo-local → $(LOG_DIR)/demo-local.log"; \
		nohup pnpm run dev:demo >$(LOG_DIR)/demo-local.log 2>&1 & \
		echo $$! >$(PID_DIR)/demo-local.pid; \
	fi

run-with-demo: run demo-local
	@printf "\n✓ run + demo-local up.  \`make seed\` to inject synthetic data.\n"
	@printf "  demo api:  http://localhost:$(DEMO_LOCAL_PORT)\n"

seed:
	@pnpm seed

smoke:
	@curl -sS -i -X POST http://localhost:$(COLLECTOR_PORT)/v1/traces \
		-H "Content-Type: application/json" \
		-d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"smoke"}}]},"scopeSpans":[{"spans":[{"traceId":"5b8aa5a2d2c872e8321cf37308d69df2","spanId":"051581bf3cb55c13","name":"smoke","kind":1,"startTimeUnixNano":"'"$$(date +%s)"'000000000","endTimeUnixNano":"'"$$(date +%s)"'000000001"}]}]}]}' \
		| head -20

# ---- upstream OTel astronomy shop (Docker, separate lifecycle) ---------------

demo-otel-setup:
	@pnpm demo:setup

demo-otel:
	@pnpm demo:up

demo-otel-down:
	@pnpm demo:down

demo-otel-logs:
	@pnpm demo:logs

# ---- housekeeping ------------------------------------------------------------

clean: stop
	@rm -rf $(DEV_DIR)
	@echo "cleaned $(DEV_DIR)/"
