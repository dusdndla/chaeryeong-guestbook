// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// ----- 업로드 폴더 준비 -----
const uploadDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// multer 설정 (이미지 파일 저장)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname); // .jpg 같은 확장자
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/[^a-zA-Z0-9가-힣_-]/g, "");
    cb(null, `${Date.now()}_${safeBase || "img"}${ext}`);
  },
});
const upload = multer({ storage });

// ----- DB 준비 -----
const dbFile = path.join(__dirname, "guestbook.db");
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      image_path TEXT,
      created_at INTEGER NOT NULL
    )`,
    (err) => {
      if (err) {
        console.error("❌ DB 테이블 생성 오류:", err);
      } else {
        console.log("✅ DB 준비 완료");
      }
    }
  );
});

// ----- 미들웨어 -----
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // public 폴더 전체 공개

// ----- API: 글 목록 조회 -----
app.get("/api/posts", (req, res) => {
  db.all(
    "SELECT id, name, message, image_path, created_at FROM posts ORDER BY created_at DESC",
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ DB 조회 오류:", err);
        return res.status(500).json({ error: "DB 조회 중 오류" });
      }
      res.json(rows);
    }
  );
});

// ----- API: 글 작성 (+ 사진 업로드) -----
// form-data로 보내고, 파일 필드는 name="image"
app.post("/api/posts", upload.single("image"), (req, res) => {
  const { name, message } = req.body || {};

  if (!name || !message || !name.trim() || !message.trim()) {
    return res.status(400).json({ error: "이름과 메시지를 모두 입력해 주세요." });
  }

  if (message.length > 300) {
    return res.status(400).json({ error: "메시지는 300자 이내로 작성해 주세요." });
  }

  const createdAt = Date.now();
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  const sql =
    "INSERT INTO posts (name, message, image_path, created_at) VALUES (?, ?, ?, ?)";
  db.run(sql, [name.trim(), message.trim(), imagePath, createdAt], function (err) {
    if (err) {
      console.error("❌ DB 저장 오류:", err);
      return res.status(500).json({ error: "메시지 저장 중 오류" });
    }

    res.status(201).json({
      id: this.lastID,
      name: name.trim(),
      message: message.trim(),
      image_path: imagePath,
      created_at: createdAt,
    });
  });
});

// ----- API: 글 삭제 (+ 사진 파일 같이 삭제) -----
app.delete("/api/posts/:id", (req, res) => {
  const id = req.params.id;

  // 먼저 해당 글의 이미지 경로를 조회
  db.get("SELECT image_path FROM posts WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error("❌ DB 조회 오류(삭제):", err);
      return res.status(500).json({ error: "삭제 중 오류" });
    }
    if (!row) {
      return res.status(404).json({ error: "해당 글을 찾을 수 없습니다." });
    }

    const imagePath = row.image_path;

    // 글 삭제
    db.run("DELETE FROM posts WHERE id = ?", [id], (err2) => {
      if (err2) {
        console.error("❌ DB 삭제 오류:", err2);
        return res.status(500).json({ error: "글 삭제 중 오류" });
      }

      // 이미지 파일도 있으면 삭제
      if (imagePath) {
        const fullPath = path.join(__dirname, "public", imagePath.replace(/^\/+/, ""));
        fs.unlink(fullPath, (err3) => {
          if (err3 && err3.code !== "ENOENT") {
            console.warn("⚠ 이미지 파일 삭제 실패:", err3.message);
          }
        });
      }

      res.json({ success: true });
    });
  });
});

// ----- 서버 시작 -----
app.listen(PORT, () => {
  console.log(`🚀 서버가 실행 중입니다: http://localhost:${PORT}`);
});
