require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "silver_oak_super_secret_key_2026";

// Load environment variables if not in production
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Initialize Gemini AI down here
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

const db = new sqlite3.Database('./silveroak.db');

// Schema Setup & Initial Seed
db.serialize(() => {
    // 1. Users Table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT CHECK(role IN ('admin', 'faculty', 'student')) NOT NULL,
        college TEXT NOT NULL,
        degree TEXT NOT NULL,
        branch TEXT NOT NULL,
        semester INTEGER DEFAULT 4,
        enrollment_no TEXT UNIQUE,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 2. Timetable / Schedule Table with UNIQUE Constraint to Prevent Duplication
    db.run(`CREATE TABLE IF NOT EXISTS timetable (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        college TEXT NOT NULL,
        degree TEXT NOT NULL,
        branch TEXT NOT NULL,
        semester INTEGER NOT NULL,
        date TEXT NOT NULL,
        lecture_number INTEGER NOT NULL,
        time_slot TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        faculty_name TEXT NOT NULL,
        faculty_id INTEGER,
        location TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(college, degree, branch, semester, date, time_slot)
    )`);

    // Deduplicate any existing duplicate entries on server startup
    db.run(`DELETE FROM timetable WHERE id NOT IN (
        SELECT MIN(id) FROM timetable GROUP BY college, degree, branch, semester, date, time_slot
    )`);

    // 3. Attendance Table
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timetable_id INTEGER,
        date TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        subject TEXT NOT NULL,
        faculty_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        status TEXT CHECK(status IN ('P', 'A')) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, time_slot, student_id)
    )`);

    // 4. Tickets Table
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        ticket_id TEXT PRIMARY KEY,
        student_id INTEGER,
        query TEXT,
        status TEXT DEFAULT 'Open',
        assigned_to TEXT,
        response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed Data
    const defaultPass = bcrypt.hashSync("12345678", 10);

    // Admin Account
    db.run(`INSERT OR IGNORE INTO users (id, name, email, password, role, college, degree, branch, semester)
            VALUES (1, 'Super Admin', 'admin@silveroak.edu', ?, 'admin', 'Silver College of Computer Application', 'Administration', 'HQ', 0)`, [defaultPass]);

    // Faculty Accounts
    const facultyList = [
        [2, 'Dr. A. K. Sharma', 'dr.sharma', 'dr.sharma@silveroak.edu'],
        [3, 'Prof. Meera Patel', 'prof.patel', 'prof.patel@silveroak.edu'],
        [4, 'Dr. Rajesh Verma', 'dr.verma', 'dr.verma@silveroak.edu'],
        [5, 'Prof. Sneha Gupta', 'prof.gupta', 'prof.gupta@silveroak.edu'],
        [6, 'Prof. Vikram Singh', 'prof.singh', 'prof.singh@silveroak.edu'],
        [7, 'Prof. Priya Joshi', 'prof.joshi', 'prof.joshi@silveroak.edu'],
        [8, 'Prof. Amit Shah', 'prof.shah', 'prof.shah@silveroak.edu']
    ];

    facultyList.forEach(([id, name, uname, email]) => {
        db.run(`INSERT OR IGNORE INTO users (id, name, username, email, password, role, college, degree, branch, semester)
                VALUES (?, ?, ?, ?, ?, 'faculty', 'Silver College of Computer Application', 'BSc', 'CS-IT', 4)`,
                [id, name, uname, email, defaultPass]);
    });

    // 20 Student Accounts
    for (let i = 1; i <= 20; i++) {
        const rollNum = i < 10 ? `0${i}` : `${i}`;
        const enroll = `230403040${rollNum}`;
        const studentName = `Student ${rollNum} CSIT`;
        const email = `student${rollNum}@silveroak.edu`;
        db.run(`INSERT OR IGNORE INTO users (name, enrollment_no, email, password, role, college, degree, branch, semester)
                VALUES (?, ?, ?, ?, 'student', 'Silver College of Computer Application', 'BSc', 'CS-IT', 4)`,
                [studentName, enroll, email, defaultPass]);
    }

    // Seed Master Timetable (Uses INSERT OR REPLACE to avoid duplicate rows)
    const today = new Date().toISOString().split('T')[0];
    const initialLectures = [
        ['Silver College of Computer Application', 'BSc', 'CS-IT', 4, today, 1, '09:00 AM - 10:00 AM', 'Data Structures & Algorithms', 'Dr. A. K. Sharma', 2, 'A-101'],
        ['Silver College of Computer Application', 'BSc', 'CS-IT', 4, today, 2, '10:00 AM - 11:00 AM', 'Database Management Systems', 'Prof. Meera Patel', 3, 'A-203'],
        ['Silver College of Computer Application', 'BSc', 'CS-IT', 4, today, 3, '11:15 AM - 12:15 PM', 'Operating Systems', 'Dr. Rajesh Verma', 4, 'A-203'],
        ['Silver College of Computer Application', 'BSc', 'CS-IT', 4, today, 4, '01:00 PM - 02:00 PM', 'Web Technology Lab', 'Prof. Sneha Gupta', 5, 'B-102'],
        ['Silver College of Computer Application', 'BSc', 'CS-IT', 4, '2026-09-28', 1, '09:00 AM - 10:00 AM', 'Data Structures & Algorithms', 'Dr. A. K. Sharma', 2, 'A-101'],
        ['Silver College of Computer Application', 'BSc', 'CS-IT', 4, '2026-09-28', 2, '10:00 AM - 11:00 AM', 'Database Management Systems', 'Prof. Meera Patel', 3, 'A-203']
    ];

    initialLectures.forEach(lec => {
        db.run(`INSERT OR REPLACE INTO timetable (college, degree, branch, semester, date, lecture_number, time_slot, subject_name, faculty_name, faculty_id, location)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, lec);
    });

    db.run(`INSERT OR IGNORE INTO tickets (ticket_id, student_id, query, status, assigned_to, response)
            VALUES ('TKT-9912', 9, 'Request for elective course syllabus copy', 'Resolved', 'Dr. A. K. Sharma', 'Approved. Check the academic documents portal.')`);

    console.log("ERP Database initialized, deduplicated, and verified.");
});

// AUTHENTICATION
app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ error: "Please enter your credentials." });

    const cleanId = identifier.trim();
    const query = `
        SELECT * FROM users 
        WHERE enrollment_no = ? 
           OR LOWER(username) = LOWER(?) 
           OR LOWER(email) = LOWER(?)
        LIMIT 1
    `;
    db.get(query, [cleanId, cleanId, cleanId], async (err, user) => {
        if (err) return res.status(500).json({ error: "Database error during login." });
        if (!user || !(await bcrypt.compare(password.trim(), user.password))) {
            return res.status(401).json({ error: "Invalid credentials. Please verify your ID and password." });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, name: user.name, college: user.college, branch: user.branch, degree: user.degree },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role,
                college: user.college,
                degree: user.degree,
                branch: user.branch,
                semester: user.semester,
                email: user.email,
                enrollment_no: user.enrollment_no
            }
        });
    });
});

// CHANGE PASSWORD
app.post('/api/auth/change-password', (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    if (!userId || !oldPassword || !newPassword) return res.status(400).json({ error: "All password fields are required." });

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], async (err, user) => {
        if (!user || !(await bcrypt.compare(oldPassword.trim(), user.password))) {
            return res.status(401).json({ error: "Current password does not match." });
        }
        const newHash = await bcrypt.hash(newPassword.trim(), 10);
        db.run(`UPDATE users SET password = ? WHERE id = ?`, [newHash, userId], (upErr) => {
            if (upErr) return res.status(500).json({ error: "Failed to update password." });
            res.json({ message: "Password updated successfully!" });
        });
    });
});

// ADMIN: CREATE USER
app.post('/api/users/create', async (req, res) => {
    const { name, email, username, password, role, college, degree, branch, semester, enrollment_no } = req.body;

    if (!name || !password || !role || !college || !degree || !branch) {
        return res.status(400).json({ error: "All fields are required. Please complete the form." });
    }
    if (role === 'student' && !enrollment_no) {
        return res.status(400).json({ error: "Enrollment number is required for student accounts." });
    }
    if (role === 'faculty' && !username) {
        return res.status(400).json({ error: "Username is required for faculty accounts." });
    }

    try {
        const hash = await bcrypt.hash(password.trim(), 10);
        const sql = `
            INSERT INTO users (name, email, username, password, role, college, degree, branch, semester, enrollment_no)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(sql, [name, email || null, username || null, hash, role, college, degree, branch, semester || 4, enrollment_no || null], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: "Duplicate error: Email, Username, or Enrollment Number already exists." });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: "Account created successfully!" });
        });
    } catch (e) {
        res.status(500).json({ error: "Password encryption failure." });
    }
});

// DIRECTORY LISTING WITH DEEP FILTERS
app.get('/api/users', (req, res) => {
    const { role, college, degree, branch, semester, targetRole } = req.query;
    let query = "SELECT id, name, username, email, role, college, degree, branch, semester, enrollment_no FROM users WHERE id != 1";
    let params = [];

    if (role === 'faculty') {
        query += " AND role = 'student' AND college = ? AND branch = ?";
        params.push(college, branch);
    } else {
        if (targetRole && targetRole !== 'all') { query += " AND role = ?"; params.push(targetRole); }
        if (college && college !== 'All') { query += " AND college = ?"; params.push(college); }
        if (degree && degree !== 'All') { query += " AND degree = ?"; params.push(degree); }
        if (branch && branch !== 'All') { query += " AND branch = ?"; params.push(branch); }
        if (semester && semester !== 'All') { query += " AND semester = ?"; params.push(semester); }
    }
    db.all(query, params, (err, rows) => res.json(rows || []));
});

app.delete('/api/users/:id', (req, res) => {
    db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], () => res.json({ message: "User permanently removed." }));
});

// ADMIN DASHBOARD STATS: TRUE HIERARCHICAL ATTENDANCE AVERAGE
app.get('/api/admin/stats', (req, res) => {
    const { college, degree, branch } = req.query;
    let uQuery = "SELECT role, COUNT(*) as count FROM users WHERE id != 1";
    let params = [];

    if (college && college !== 'All') { uQuery += " AND college = ?"; params.push(college); }
    if (degree && degree !== 'All') { uQuery += " AND degree = ?"; params.push(degree); }
    if (branch && branch !== 'All') { uQuery += " AND branch = ?"; params.push(branch); }
    uQuery += " GROUP BY role";

    db.all(uQuery, params, (err, rows) => {
        let students = 0, faculty = 0;
        (rows || []).forEach(r => {
            if (r.role === 'student') students = r.count;
            if (r.role === 'faculty') faculty = r.count;
        });

        // Ticket count with filters
        let tQuery = `SELECT COUNT(*) as ticketCount FROM tickets t LEFT JOIN users u ON t.student_id = u.id WHERE 1=1`;
        let tParams = [];
        if (college && college !== 'All') { tQuery += " AND u.college = ?"; tParams.push(college); }
        if (degree && degree !== 'All') { tQuery += " AND u.degree = ?"; tParams.push(degree); }
        if (branch && branch !== 'All') { tQuery += " AND u.branch = ?"; tParams.push(branch); }

        db.get(tQuery, tParams, (tErr, tRow) => {
            // Hierarchical Attendance Calculation:
            let aQuery = `
                SELECT a.status FROM attendance a
                JOIN users u ON a.student_id = u.id
                WHERE 1=1
            `;
            let aParams = [];
            if (college && college !== 'All') { aQuery += " AND u.college = ?"; aParams.push(college); }
            if (degree && degree !== 'All') { aQuery += " AND u.degree = ?"; aParams.push(degree); }
            if (branch && branch !== 'All') { aQuery += " AND u.branch = ?"; aParams.push(branch); }

            db.all(aQuery, aParams, (aErr, aRows) => {
                const total = (aRows || []).length;
                const present = (aRows || []).filter(x => x.status === 'P').length;
                const avgAttendance = total === 0 ? "100%" : `${Math.round((present / total) * 100)}%`;

                res.json({
                    students,
                    faculty,
                    tickets: tRow ? tRow.ticketCount : 0,
                    avgAttendance
                });
            });
        });
    });
});

// TIMETABLE ROUTES
app.get('/api/timetable', (req, res) => {
    const { date, college, degree, branch, semester, faculty_id } = req.query;
    let query = "SELECT * FROM timetable WHERE 1=1";
    let params = [];

    if (date && date !== 'All') { query += " AND date = ?"; params.push(date); }
    if (college && college !== 'All') { query += " AND college = ?"; params.push(college); }
    if (degree && degree !== 'All') { query += " AND degree = ?"; params.push(degree); }
    if (branch && branch !== 'All') { query += " AND branch = ?"; params.push(branch); }
    if (semester && semester !== 'All') { query += " AND semester = ?"; params.push(semester); }
    if (faculty_id) { query += " AND faculty_id = ?"; params.push(faculty_id); }

    query += " ORDER BY date DESC, lecture_number ASC";
    db.all(query, params, (err, rows) => res.json(rows || []));
});

// 1. Manual Timetable Entry (Auto-Computes Lecture Number and Merges Duplicates)
app.post('/api/timetable/create', (req, res) => {
    const { college, degree, branch, semester, date, time_slot, subject_name, faculty_name, location } = req.body;
    if (!college || !degree || !branch || !date || !time_slot || !subject_name || !faculty_name) {
        return res.status(400).json({ error: "Missing required timetable fields." });
    }

    const TIME_SLOT_ORDER = {
        "09:00 AM - 10:00 AM": 1,
        "10:00 AM - 11:00 AM": 2,
        "10:15 AM - 11:15 AM": 2,
        "11:15 AM - 12:15 PM": 3,
        "11:30 AM - 12:30 PM": 3,
        "01:00 PM - 02:00 PM": 4,
        "01:15 PM - 02:15 PM": 4,
        "02:00 PM - 03:00 PM": 5,
        "02:30 PM - 03:30 PM": 5,
        "03:15 PM - 04:15 PM": 6
    };
    const computedLecNumber = TIME_SLOT_ORDER[time_slot] || 1;

    db.get(`SELECT id FROM users WHERE role = 'faculty' AND name = ? LIMIT 1`, [faculty_name], (err, fac) => {
        const facultyId = fac ? fac.id : null;
        // INSERT OR REPLACE automatically updates/merges duplicate schedules
        db.run(`INSERT OR REPLACE INTO timetable (college, degree, branch, semester, date, lecture_number, time_slot, subject_name, faculty_name, faculty_id, location)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [college, degree, branch, parseInt(semester) || 4, date, computedLecNumber, time_slot, subject_name, faculty_name, facultyId, location || 'A-101'],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: `Lecture #${computedLecNumber} saved & verified in timetable!` });
                });
    });
});

// 2. CSV Bulk Timetable Import (Uses INSERT OR REPLACE to Deduplicate)
app.post('/api/timetable/batch-csv', (req, res) => {
    const { csvData } = req.body;
    if (!csvData) return res.status(400).json({ error: "CSV data is empty." });

    const lines = csvData.trim().split('\n');
    let inserted = 0;

    db.serialize(() => {
        const stmt = db.prepare(`INSERT OR REPLACE INTO timetable (college, degree, branch, semester, date, lecture_number, time_slot, subject_name, faculty_name, location)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(',').map(c => c.trim());
            if (cols.length >= 10) {
                stmt.run([cols[0], cols[1], cols[2], parseInt(cols[3]) || 4, cols[4], parseInt(cols[5]) || 1, cols[6], cols[7], cols[8], cols[9]]);
                inserted++;
            }
        }
        stmt.finalize(() => {
            res.json({ message: `Successfully imported ${inserted} timetable lectures (Duplicates merged).` });
        });
    });
});

// 3. JSON Bulk Timetable Import (Uses INSERT OR REPLACE to Deduplicate)
app.post('/api/timetable/batch-json', (req, res) => {
    const { jsonData } = req.body;
    let parsed;
    try {
        parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    } catch (e) {
        return res.status(400).json({ error: "Invalid JSON structure." });
    }

    const { college_name, degree, branch, semester, schedule } = parsed;
    if (!schedule) return res.status(400).json({ error: "Missing 'schedule' key in JSON payload." });

    let count = 0;
    db.serialize(() => {
        const stmt = db.prepare(`INSERT OR REPLACE INTO timetable (college, degree, branch, semester, date, lecture_number, time_slot, subject_name, faculty_name, location)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

        Object.keys(schedule).forEach(dateStr => {
            schedule[dateStr].forEach(lec => {
                stmt.run([college_name, degree, branch, semester || 4, dateStr, lec.lecture_number, lec.time, lec.subject_name, lec.faculty_name, lec.location]);
                count++;
            });
        });

        stmt.finalize(() => {
            res.json({ message: `Imported ${count} schedule entries successfully (Duplicates merged).` });
        });
    });
});

app.delete('/api/timetable/:id', (req, res) => {
    db.run(`DELETE FROM timetable WHERE id = ?`, [req.params.id], () => res.json({ message: "Scheduled lecture removed." }));
});

// ATTENDANCE SYSTEM (3-Hour Edit Window Lock)
app.post('/api/attendance', (req, res) => {
    const { timetable_id, date, time_slot, subject, faculty_id, records } = req.body;
    if (!date || !time_slot || !subject || !Array.isArray(records)) {
        return res.status(400).json({ error: "Incomplete attendance payload." });
    }

    db.get(`SELECT created_at FROM attendance WHERE date = ? AND time_slot = ? AND faculty_id = ? LIMIT 1`, [date, time_slot, faculty_id], (err, existing) => {
        if (existing) {
            const diffHours = (new Date() - new Date(existing.created_at)) / (1000 * 60 * 60);
            if (diffHours > 3) {
                return res.status(403).json({ error: "LOCKED: Attendance for this lecture was submitted more than 3 hours ago and can no longer be modified." });
            }
        }

        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT INTO attendance (timetable_id, date, time_slot, subject, faculty_id, student_id, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(date, time_slot, student_id) 
                DO UPDATE SET status=excluded.status, updated_at=CURRENT_TIMESTAMP
            `);

            records.forEach(r => {
                const status = (r.status === 'P') ? 'P' : 'A';
                stmt.run([timetable_id || null, date, time_slot, subject, faculty_id, r.student_id, status]);
            });

            stmt.finalize(() => {
                io.emit('attendance_updated', { date, time_slot, subject });
                res.json({ message: "Attendance Register successfully committed!" });
            });
        });
    });
});

// GET ATTENDANCE
app.get('/api/attendance', (req, res) => {
    const { role, student_id, date, time_slot, faculty_id } = req.query;

    if (role === 'student') {
        const queryDate = date || new Date().toISOString().split('T')[0];

        db.get(`SELECT college, degree, branch, semester FROM users WHERE id = ?`, [student_id], (err, student) => {
            if (!student) return res.json([]);

            db.all(`SELECT * FROM timetable WHERE college = ? AND branch = ? AND date = ? ORDER BY lecture_number ASC`,
                [student.college, student.branch, queryDate], (tErr, scheduledLectures) => {

                db.all(`SELECT a.*, u.name as faculty_name FROM attendance a 
                        JOIN users u ON a.faculty_id = u.id 
                        WHERE a.student_id = ? AND a.date = ?`, [student_id, queryDate], (aErr, markedRows) => {

                    const markedMap = {};
                    (markedRows || []).forEach(m => markedMap[m.time_slot] = m);

                    const results = (scheduledLectures || []).map(lec => {
                        const marked = markedMap[lec.time_slot];
                        return {
                            timetable_id: lec.id,
                            date: lec.date,
                            lecture_number: lec.lecture_number,
                            time_slot: lec.time_slot,
                            subject: lec.subject_name,
                            faculty_name: lec.faculty_name,
                            location: lec.location,
                            status: marked ? marked.status : 'Unmarked'
                        };
                    });

                    res.json(results);
                });
            });
        });

    } else if (role === 'faculty') {
        db.all(`SELECT student_id, status FROM attendance WHERE date = ? AND time_slot = ? AND faculty_id = ?`,
            [date, time_slot, faculty_id], (err, rows) => res.json(rows || []));
    }
});

app.get('/api/attendance/summary', (req, res) => {
    const { student_id } = req.query;
    db.all(`SELECT status FROM attendance WHERE student_id = ?`, [student_id], (err, rows) => {
        const total = (rows || []).length;
        const present = (rows || []).filter(r => r.status === 'P').length;
        const absent = (rows || []).filter(r => r.status === 'A').length;
        const percentage = total === 0 ? 100 : Math.round((present / total) * 100);
        res.json({ total, present, absent, percentage });
    });
});

// TICKETS MANAGEMENT
app.get('/api/tickets', (req, res) => {
    const { role, userId, college, branch, status } = req.query;
    let query = `
        SELECT t.*, u.name as student_name, u.enrollment_no, u.college, u.degree, u.branch, u.semester 
        FROM tickets t 
        LEFT JOIN users u ON t.student_id = u.id 
        WHERE 1=1
    `;
    let params = [];

    if (role === 'student') {
        query += " AND t.student_id = ?";
        params.push(userId);
    } else if (role === 'faculty') {
        query += " AND u.college = ? AND u.branch = ?";
        params.push(college, branch);
    } else if (role === 'admin') {
        if (college && college !== 'All') { query += " AND u.college = ?"; params.push(college); }
        if (branch && branch !== 'All') { query += " AND u.branch = ?"; params.push(branch); }
    }

    if (status && status !== 'All') {
        query += " AND t.status = ?";
        params.push(status);
    }

    query += " ORDER BY t.created_at DESC";
    db.all(query, params, (err, rows) => res.json(rows || []));
});

app.post('/api/tickets/reply', (req, res) => {
    const { ticketId, replyText, facultyName } = req.body;
    db.run(`UPDATE tickets SET status = 'Resolved', response = ?, assigned_to = COALESCE(?, assigned_to) WHERE ticket_id = ?`,
        [replyText, facultyName, ticketId], () => {
            io.emit('ticket_updated');
            res.json({ message: "Ticket resolved successfully!" });
        });
});

app.delete('/api/tickets/:id', (req, res) => {
    db.run(`DELETE FROM tickets WHERE ticket_id = ?`, [req.params.id], () => res.json({ message: "Ticket deleted." }));
});

// MULTI-AGENT AI CHAT
app.post('/api/chat', async (req, res) => {
    const { message, studentId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "Empty query." });

    const lowerMsg = message.toLowerCase().trim();
    if (["hi", "hello", "hey", "help", "namaste", "good morning"].includes(lowerMsg)) {
        return res.json({
            intent: "Greeting",
            confidenceScore: 100,
            requiresRouting: false,
            response: "Hello! I am your 24/7 Silver Oak AI Help Desk Agent. How can I assist you with your academic schedule, fees, or department questions today?"
        });
    }

    const ticketId = `TKT-${Math.floor(Math.random() * 90000) + 10000}`;
    const createTicket = (aiData, aiResponseText, assignedTo) => {
        db.run(`INSERT INTO tickets (ticket_id, student_id, query, assigned_to) VALUES (?, ?, ?, ?)`,
            [ticketId, studentId, message, assignedTo], () => {
                io.emit('new_ticket_created');
                res.json({ ...aiData, requiresRouting: true, ticketId, response: aiResponseText });
            });
    };

    try {
        const prompt = `You are a Multi-Agent AI System for Silver Oak University. 
Act as Intent Recognition Agent, Entity Extraction Agent, and Decision Agent.
Return EXACTLY this JSON format (no markdown): {"intent":"...","entities":["..."],"response":"...","confidenceScore":85} 
Query: "${message}"`;

        const result = await model.generateContent(prompt);
        let cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const aiData = JSON.parse(cleaned);

        if (aiData.confidenceScore < 80) {
            db.get(`SELECT college, branch FROM users WHERE id = ?`, [studentId], (err, student) => {
                const queryStr = student
                    ? `SELECT name FROM users WHERE role='faculty' AND college=? ORDER BY (branch = ?) DESC, RANDOM() LIMIT 1`
                    : `SELECT name FROM users WHERE role='faculty' ORDER BY RANDOM() LIMIT 1`;
                const params = student ? [student.college, student.branch] : [];
                db.get(queryStr, params, (err, faculty) => {
                    const assignedTo = faculty ? faculty.name : "Department Faculty Desk";
                    createTicket(aiData, `Decision Agent flagged this query for faculty attention. Ticket #${ticketId} created and assigned to ${assignedTo}.`, assignedTo);
                });
            });
        } else {
            res.json({ ...aiData, requiresRouting: false });
        }
    } catch (err) {
        createTicket({ intent: "System Fallback", confidenceScore: 40 }, `High cognitive load. Priority Ticket #${ticketId} created for department coordinator review.`, "Department Coordinator");
    }
});

server.listen(PORT, () => console.log(`Silver Oak ERP Backend running on http://localhost:${PORT}`));