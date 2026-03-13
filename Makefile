.PHONY: setup-dev dev setup-prod stop

setup-dev:
	npm install
	@echo ""
	@echo "Setup complete! Run 'make dev' to start the dev server with hot-reload."

dev:
	npx nodemon server.js

setup-prod:
	docker compose up --build -d
	@echo ""
	@echo "Production containers are running."
	@echo "Access the game at: http://<your-vps-ip>:8099/asteroid-apocalypse-defenders/"

stop:
	docker compose down
