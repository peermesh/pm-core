package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/peermesh/docker-lab/services/dashboard/handlers"
)

const (
	defaultPort    = "8080"
	readTimeout    = 10 * time.Second
	writeTimeout   = 30 * time.Second
	idleTimeout    = 60 * time.Second
	shutdownTimeout = 30 * time.Second
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	mux := http.NewServeMux()

	// Health check endpoint (no auth required)
	mux.HandleFunc("/health", healthHandler)

	// Auth endpoints
	mux.HandleFunc("/api/login", handlers.LoginHandler)
	mux.HandleFunc("/api/logout", handlers.LogoutHandler)

	// API endpoints
	mux.HandleFunc("/api/system", handlers.SystemHandler)
	mux.HandleFunc("/api/containers", handlers.ContainersHandler)
	mux.HandleFunc("/api/events", handlers.EventsHandler)

	// Static file server
	staticFS := http.FileServer(http.Dir("./static"))
	mux.Handle("/", staticFS)

	// Wrap with auth middleware
	handler := handlers.AuthMiddleware(mux)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  idleTimeout,
	}

	// Channel to listen for errors from server
	serverErrors := make(chan error, 1)

	// Start server in goroutine
	go func() {
		log.Printf("Dashboard server starting on port %s", port)
		serverErrors <- server.ListenAndServe()
	}()

	// Channel to listen for interrupt signals
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	// Block until we receive a signal or server error
	select {
	case err := <-serverErrors:
		if err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	case sig := <-shutdown:
		log.Printf("Shutdown signal received: %v", sig)

		// Create context with timeout for graceful shutdown
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		// Attempt graceful shutdown
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("Graceful shutdown failed: %v", err)
			if err := server.Close(); err != nil {
				log.Fatalf("Forced shutdown failed: %v", err)
			}
		}

		log.Println("Server stopped gracefully")
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"healthy"}`))
}
