package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// ── Model ─────────────────────────────────────────────────────────────────────

type Expense struct {
	ID          string  `json:"id"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	PaidBy      string  `json:"paid_by"`
	Category    string  `json:"category"`
	Date        string  `json:"date"` // ISO 8601: "2024-04-22"
}

// ── In-memory store ───────────────────────────────────────────────────────────

type Store struct {
	mu       sync.RWMutex
	expenses []Expense
	nextID   int
}

func NewStore() *Store {
	s := &Store{nextID: 1}
	// Seed with sample data so the page looks populated on first load
	s.expenses = []Expense{
		{ID: "1", Description: "Dinner at Rosini", Amount: 64.00, PaidBy: "Emma", Category: "🍽️", Date: "2024-04-20"},
		{ID: "2", Description: "Groceries", Amount: 38.50, PaidBy: "Ferdinand", Category: "🛒", Date: "2024-04-21"},
		{ID: "3", Description: "Train tickets", Amount: 52.00, PaidBy: "Emma", Category: "🚗", Date: "2024-04-22"},
	}
	s.nextID = 4
	return s
}

func (s *Store) List() []Expense {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Expense, len(s.expenses))
	copy(out, s.expenses)
	return out
}

func (s *Store) Add(e Expense) Expense {
	s.mu.Lock()
	defer s.mu.Unlock()
	e.ID = fmt.Sprintf("%d", s.nextID)
	s.nextID++
	s.expenses = append(s.expenses, e)
	return e
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (s *Store) handleExpenses(w http.ResponseWriter, r *http.Request) {
	switch r.Method {

	// GET /api/expenses — return all expenses as JSON
	case http.MethodGet:
		expenses := s.List()
		writeJSON(w, http.StatusOK, expenses)

	// POST /api/expenses — create a new expense
	case http.MethodPost:
		var input Expense
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}

		if input.Description == "" {
			http.Error(w, "description is required", http.StatusBadRequest)
			return
		}
		if input.Amount <= 0 {
			http.Error(w, "amount must be greater than 0", http.StatusBadRequest)
			return
		}
		if input.PaidBy != "Emma" && input.PaidBy != "Ferdinand" {
			http.Error(w, `paid_by must be "Emma" or "Ferdinand"`, http.StatusBadRequest)
			return
		}
		if input.Date == "" {
			input.Date = time.Now().Format("2006-01-02")
		}

		saved := s.Add(input)
		log.Printf("POST /api/expenses  id=%s  desc=%q  amount=%.2f  paid_by=%s",
			saved.ID, saved.Description, saved.Amount, saved.PaidBy)
		writeJSON(w, http.StatusCreated, saved)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON error: %v", err)
	}
}

// loggingMiddleware logs method, path, and response time for every request.
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s  %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	store := NewStore()

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/expenses", store.handleExpenses)

	// Serve static files (index.html, style.css, app.js) from ./static/
	// Put your frontend files in a "static" subdirectory next to this binary.
	fs := http.FileServer(http.Dir("./static"))
	mux.Handle("/", fs)

	addr := ":8080"
	log.Printf("Listening on http://localhost%s", addr)
	log.Printf("Serving static files from ./static/")

	if err := http.ListenAndServe(addr, loggingMiddleware(mux)); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
