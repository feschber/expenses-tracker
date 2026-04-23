package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
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

// ── Store ─────────────────────────────────────────────────────────────────────

type Store struct {
	db *sql.DB
}

func NewStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Single writer — avoids "database is locked" under concurrent requests.
	db.SetMaxOpenConns(1)

	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS expenses (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			description TEXT    NOT NULL,
			amount      REAL    NOT NULL,
			paid_by     TEXT    NOT NULL,
			category    TEXT    NOT NULL DEFAULT '',
			date        TEXT    NOT NULL
		);
	`)
	return err
}

func (s *Store) List() ([]Expense, error) {
	rows, err := s.db.Query(
		`SELECT id, description, amount, paid_by, category, date
		 FROM expenses ORDER BY id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var expenses []Expense
	for rows.Next() {
		var e Expense
		if err := rows.Scan(&e.ID, &e.Description, &e.Amount, &e.PaidBy, &e.Category, &e.Date); err != nil {
			return nil, err
		}
		expenses = append(expenses, e)
	}
	return expenses, rows.Err()
}

func (s *Store) Delete(id string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM expenses WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) Add(e Expense) (Expense, error) {
	res, err := s.db.Exec(
		`INSERT INTO expenses (description, amount, paid_by, category, date)
		 VALUES (?, ?, ?, ?, ?)`,
		e.Description, e.Amount, e.PaidBy, e.Category, e.Date,
	)
	if err != nil {
		return Expense{}, err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return Expense{}, err
	}

	e.ID = fmt.Sprintf("%d", id)
	return e, nil
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (s *Store) handleExpenses(w http.ResponseWriter, r *http.Request) {
	switch r.Method {

	// GET /api/expenses — return all expenses as JSON
	case http.MethodGet:
		expenses, err := s.List()
		if err != nil {
			log.Printf("List error: %v", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		// Return an empty array instead of null when there are no expenses
		if expenses == nil {
			expenses = []Expense{}
		}
		writeJSON(w, http.StatusOK, expenses)

	// POST /api/expenses — create and persist a new expense
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
		if input.Category == "" {
			input.Category = "📦"
		}
		if input.Date == "" {
			input.Date = time.Now().Format("2006-01-02")
		}

		saved, err := s.Add(input)
		if err != nil {
			log.Printf("Add error: %v", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		log.Printf("POST /api/expenses  id=%s  desc=%q  amount=%.2f  paid_by=%s",
			saved.ID, saved.Description, saved.Amount, saved.PaidBy)
		writeJSON(w, http.StatusCreated, saved)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleExpense handles DELETE /api/expenses/{id}
func (s *Store) handleExpense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}

	found, err := s.Delete(id)
	if err != nil {
		log.Printf("Delete error: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if !found {
		http.Error(w, "expense not found", http.StatusNotFound)
		return
	}

	log.Printf("DELETE /api/expenses/%s", id)
	w.WriteHeader(http.StatusNoContent)
}

// ── Personal view handler ─────────────────────────────────────────────────────

// servePersonalView reads index.html, injects the active-user meta tag, and
// writes the result directly — avoiding http.ServeFile's redirect behaviour.
func servePersonalView(user string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		html, err := os.ReadFile("./static/index.html")
		if err != nil {
			http.Error(w, "could not read index.html", http.StatusInternalServerError)
			return
		}

		patched := strings.Replace(
			string(html),
			`<meta charset="UTF-8" />`,
			`<meta charset="UTF-8" />`+"\n  "+`<meta name="active-user" content="`+user+`" />`,
			1,
		)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, patched)
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
	store, err := NewStore("expenses.db")
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/expenses", store.handleExpenses)
	mux.HandleFunc("/api/expenses/{id}", store.handleExpense)

	// Personal views — inject the active user into the page
	fs := http.FileServer(http.Dir("./static"))
	mux.HandleFunc("/emma",      servePersonalView("Emma"))
	mux.HandleFunc("/ferdinand", servePersonalView("Ferdinand"))
	mux.Handle("/", fs)

	addr := ":8080"
	log.Printf("Listening on http://localhost%s", addr)
	log.Printf("  /          shared view")
	log.Printf("  /emma      Emma's personal view")
	log.Printf("  /ferdinand Ferdinand's personal view")
	log.Printf("Database: expenses.db")
	log.Printf("Static files: ./static/")

	if err := http.ListenAndServe(addr, loggingMiddleware(mux)); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
