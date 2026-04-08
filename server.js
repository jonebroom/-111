const express = require('express');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const DB_PATH = path.join(__dirname, 'guestbook.db');
const AUTHOR_KEY = 'guestbook_admin_key'; // 作者密钥，可修改

let db;

// 初始化数据库
async function initDB() {
  const SQL = await initSqlJs();

  // 尝试加载现有数据库
  let data = null;
  if (fs.existsSync(DB_PATH)) {
    data = fs.readFileSync(DB_PATH);
  }

  db = new SQL.Database(data);

  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      image TEXT,
      likes INTEGER DEFAULT 0,
      gifts TEXT DEFAULT '[]',
      author_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);

  // 想吃的东西
  db.run(`
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      item_date TEXT,
      likes INTEGER DEFAULT 0,
      wanted TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 想去的旅游地方
  db.run(`
    CREATE TABLE IF NOT EXISTS travels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      item_date TEXT,
      likes INTEGER DEFAULT 0,
      wanted TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 未来的小目标
  db.run(`
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      item_date TEXT,
      likes INTEGER DEFAULT 0,
      supported TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 照片墙
  db.run(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image TEXT NOT NULL,
      note TEXT,
      username TEXT,
      message_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 日历事件
  db.run(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      note TEXT,
      calendar_type TEXT DEFAULT '公历',
      repeat_type TEXT DEFAULT '不重复',
      lunar_month TEXT,
      lunar_day TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 添加缺失的列（如果表已存在）
  try { db.run('ALTER TABLE calendar_events ADD COLUMN lunar_month TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE calendar_events ADD COLUMN lunar_day TEXT'); } catch(e) {}

  // 食品评论
  db.run(`
    CREATE TABLE IF NOT EXISTS food_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      food_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 旅游评论
  db.run(`
    CREATE TABLE IF NOT EXISTS travel_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      travel_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 目标评论
  db.run(`
    CREATE TABLE IF NOT EXISTS goal_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDB();
  console.log('数据库初始化完成');
}

// 保存数据库到文件
function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// 生成作者密钥
function generateAuthorKey() {
  return crypto.randomBytes(16).toString('hex');
}

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API: 获取所有留言
app.get('/api/messages', (req, res) => {
  try {
    const messages = db.exec(`
      SELECT m.id, m.username, m.content, m.image, m.likes, m.gifts, m.author_key, m.created_at,
        (SELECT COUNT(*) FROM comments WHERE message_id = m.id) as comment_count
      FROM messages m
      ORDER BY m.created_at DESC
    `);

    if (messages.length === 0) {
      return res.json([]);
    }

    const columns = messages[0].columns;
    const values = messages[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });

    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 发布新留言
app.post('/api/messages', (req, res) => {
  try {
    const { username, content, image } = req.body;

    if (!username || !content) {
      return res.status(400).json({ error: '用户名和留言内容不能为空' });
    }

    if (username.length > 50 || content.length > 1000) {
      return res.status(400).json({ error: '用户名或内容过长' });
    }

    const createdAt = new Date().toISOString();

    db.run(
      'INSERT INTO messages (username, content, image, created_at) VALUES (?, ?, ?, ?)',
      [username, content, image || null, createdAt]
    );

    const result = db.exec('SELECT last_insert_rowid() as id');
    const lastId = result[0].values[0][0];

    const newMessage = db.exec('SELECT * FROM messages WHERE id = ?', [lastId]);
    const columns = newMessage[0].columns;
    const row = newMessage[0].values[0];
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    // 如果有图片，自动保存到照片墙
    if (image) {
      const dateStr = new Date(createdAt).toLocaleDateString('zh-CN');
      db.run('INSERT INTO photos (image, note, username, message_date, created_at) VALUES (?, ?, ?, ?, ?)',
        [image, content, username, dateStr, createdAt]);
    }

    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 编辑留言
app.put('/api/messages/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { content, username } = req.body;

    if (!content || content.length > 1000) {
      return res.status(400).json({ error: '内容不能为空或过长' });
    }

    // 验证作者身份
    const check = db.exec('SELECT username FROM messages WHERE id = ?', [id]);
    if (check.length === 0) {
      return res.status(404).json({ error: '留言不存在' });
    }

    const messageAuthor = check[0].values[0][0];
    if (messageAuthor !== username) {
      return res.status(403).json({ error: '你只能编辑自己的留言' });
    }

    db.run('UPDATE messages SET content = ? WHERE id = ?', [content, id]);

    const updated = db.exec('SELECT * FROM messages WHERE id = ?', [id]);
    const columns = updated[0].columns;
    const row = updated[0].values[0];
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 删除留言
app.delete('/api/messages/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;

    // 验证作者身份
    const check = db.exec('SELECT username, image FROM messages WHERE id = ?', [id]);
    if (check.length === 0 || check[0].values.length === 0) {
      return res.status(404).json({ error: '留言不存在' });
    }

    const messageAuthor = check[0].values[0][0];
    const messageImage = check[0].values[0][1];
    if (messageAuthor !== username) {
      return res.status(403).json({ error: '你只能删除自己的留言' });
    }

    // 删除评论
    db.run('DELETE FROM comments WHERE message_id = ?', [id]);

    // 删除留言
    db.run('DELETE FROM messages WHERE id = ?', [id]);

    // 如果有图片，删除照片墙中对应的照片
    if (messageImage) {
      db.run('DELETE FROM photos WHERE image = ?', [messageImage]);
    }

    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 点赞留言
app.post('/api/messages/:id/like', (req, res) => {
  try {
    const { id } = req.params;

    db.run('UPDATE messages SET likes = likes + 1 WHERE id = ?', [id]);

    const result = db.exec('SELECT likes FROM messages WHERE id = ?', [id]);
    const likes = result[0].values[0][0];

    saveDB();
    res.json({ likes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 取消点赞
app.delete('/api/messages/:id/like', (req, res) => {
  try {
    const { id } = req.params;

    db.run('UPDATE messages SET likes = likes - 1 WHERE id = ? AND likes > 0', [id]);

    const result = db.exec('SELECT likes FROM messages WHERE id = ?', [id]);
    const likes = result[0].values[0][0];

    saveDB();
    res.json({ likes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 删除评论
app.delete('/api/comments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;

    // 验证是否是评论作者
    const check = db.exec('SELECT username FROM comments WHERE id = ?', [id]);
    if (check.length === 0 || check[0].values.length === 0) {
      return res.status(404).json({ error: '评论不存在' });
    }

    const commentAuthor = check[0].values[0][0];
    if (commentAuthor !== username) {
      return res.status(403).json({ error: '你只能删除自己的评论' });
    }

    db.run('DELETE FROM comments WHERE id = ?', [id]);

    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 送礼物
app.post('/api/messages/:id/gift', (req, res) => {
  try {
    const { id } = req.params;
    const { giftType, senderName } = req.body;

    const validGifts = ['玫瑰', '爱心', '星星', '蛋糕', '钻石', '红包'];
    if (!validGifts.includes(giftType)) {
      return res.status(400).json({ error: '无效的礼物类型' });
    }

    if (!senderName || senderName.length > 50) {
      return res.status(400).json({ error: '请填写昵称' });
    }

    // 获取现有礼物
    const result = db.exec('SELECT gifts FROM messages WHERE id = ?', [id]);
    let gifts = [];
    if (result.length > 0 && result[0].values[0][0]) {
      try {
        gifts = JSON.parse(result[0].values[0][0]);
      } catch (e) {
        gifts = [];
      }
    }

    // 添加新礼物
    gifts.push({
      type: giftType,
      sender: senderName,
      time: new Date().toISOString()
    });

    db.run('UPDATE messages SET gifts = ? WHERE id = ?', [JSON.stringify(gifts), id]);

    saveDB();
    res.json({ gifts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 获取留言的评论
app.get('/api/messages/:id/comments', (req, res) => {
  try {
    const { id } = req.params;

    const comments = db.exec(`
      SELECT * FROM comments
      WHERE message_id = ?
      ORDER BY created_at ASC
    `, [id]);

    if (comments.length === 0) {
      return res.json([]);
    }

    const columns = comments[0].columns;
    const values = comments[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });

    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 发表评论
app.post('/api/messages/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const { username, content } = req.body;

    if (!username || !content) {
      return res.status(400).json({ error: '用户名和评论内容不能为空' });
    }

    const createdAt = new Date().toISOString();
    db.run(
      'INSERT INTO comments (message_id, username, content, created_at) VALUES (?, ?, ?, ?)',
      [id, username, content, createdAt]
    );

    const result = db.exec('SELECT last_insert_rowid() as id');
    const lastId = result[0].values[0][0];

    const newComment = db.exec('SELECT * FROM comments WHERE id = ?', [lastId]);
    const columns = newComment[0].columns;
    const row = newComment[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);

    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 想吃的东西 API ==========
app.get('/api/foods', (req, res) => {
  try {
    const messages = db.exec('SELECT * FROM foods ORDER BY created_at DESC');
    if (messages.length === 0) return res.json([]);
    const columns = messages[0].columns;
    const values = messages[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/foods', (req, res) => {
  try {
    const { username, content, item_date } = req.body;
    if (!username || !content) return res.status(400).json({ error: '请填写完整信息' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO foods (username, content, item_date, created_at) VALUES (?, ?, ?, ?)', [username, content, item_date || null, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newItem = db.exec('SELECT * FROM foods WHERE id = ?', [result[0].values[0][0]]);
    const columns = newItem[0].columns;
    const row = newItem[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/foods/:id/want', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const result = db.exec('SELECT wanted FROM foods WHERE id = ?', [id]);
    let wanted = [];
    if (result.length > 0 && result[0].values[0][0]) wanted = JSON.parse(result[0].values[0][0]);
    if (!wanted.includes(username)) wanted.push(username);
    db.run('UPDATE foods SET wanted = ? WHERE id = ?', [JSON.stringify(wanted), id]);
    saveDB();
    res.json({ wanted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/foods/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM foods WHERE id = ?', [id]);
    if (check.length === 0) return res.status(404).json({ error: '不存在' });
    if (check[0].values[0][0] !== username) return res.status(403).json({ error: '只能删除自己的' });
    db.run('DELETE FROM foods WHERE id = ?', [id]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 想去的旅游地方 API ==========
app.get('/api/travels', (req, res) => {
  try {
    const messages = db.exec('SELECT * FROM travels ORDER BY created_at DESC');
    if (messages.length === 0) return res.json([]);
    const columns = messages[0].columns;
    const values = messages[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/travels', (req, res) => {
  try {
    const { username, content, item_date } = req.body;
    if (!username || !content) return res.status(400).json({ error: '请填写完整信息' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO travels (username, content, item_date, created_at) VALUES (?, ?, ?, ?)', [username, content, item_date || null, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newItem = db.exec('SELECT * FROM travels WHERE id = ?', [result[0].values[0][0]]);
    const columns = newItem[0].columns;
    const row = newItem[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/travels/:id/want', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const result = db.exec('SELECT wanted FROM travels WHERE id = ?', [id]);
    let wanted = [];
    if (result.length > 0 && result[0].values[0][0]) wanted = JSON.parse(result[0].values[0][0]);
    if (!wanted.includes(username)) wanted.push(username);
    db.run('UPDATE travels SET wanted = ? WHERE id = ?', [JSON.stringify(wanted), id]);
    saveDB();
    res.json({ wanted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/travels/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM travels WHERE id = ?', [id]);
    if (check.length === 0) return res.status(404).json({ error: '不存在' });
    if (check[0].values[0][0] !== username) return res.status(403).json({ error: '只能删除自己的' });
    db.run('DELETE FROM travels WHERE id = ?', [id]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 未来的小目标 API ==========
app.get('/api/goals', (req, res) => {
  try {
    const messages = db.exec('SELECT * FROM goals ORDER BY created_at DESC');
    if (messages.length === 0) return res.json([]);
    const columns = messages[0].columns;
    const values = messages[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/goals', (req, res) => {
  try {
    const { username, content, item_date } = req.body;
    if (!username || !content) return res.status(400).json({ error: '请填写完整信息' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO goals (username, content, item_date, created_at) VALUES (?, ?, ?, ?)', [username, content, item_date || null, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newItem = db.exec('SELECT * FROM goals WHERE id = ?', [result[0].values[0][0]]);
    const columns = newItem[0].columns;
    const row = newItem[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/goals/:id/support', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const result = db.exec('SELECT supported FROM goals WHERE id = ?', [id]);
    let supported = [];
    if (result.length > 0 && result[0].values[0][0]) supported = JSON.parse(result[0].values[0][0]);
    if (!supported.includes(username)) supported.push(username);
    db.run('UPDATE goals SET supported = ? WHERE id = ?', [JSON.stringify(supported), id]);
    saveDB();
    res.json({ supported });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/goals/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM goals WHERE id = ?', [id]);
    if (check.length === 0) return res.status(404).json({ error: '不存在' });
    if (check[0].values[0][0] !== username) return res.status(403).json({ error: '只能删除自己的' });
    db.run('DELETE FROM goals WHERE id = ?', [id]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 照片墙 API ==========
app.get('/api/photos', (req, res) => {
  try {
    const photos = db.exec('SELECT * FROM photos ORDER BY created_at DESC LIMIT 100');
    if (photos.length === 0) return res.json([]);
    const columns = photos[0].columns;
    const values = photos[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加照片到照片墙
app.post('/api/photos', (req, res) => {
  try {
    const { image, note, username, message_date } = req.body;
    if (!image) return res.status(400).json({ error: '图片不能为空' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO photos (image, note, username, message_date, created_at) VALUES (?, ?, ?, ?, ?)',
      [image, note || null, username || null, message_date || null, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newPhoto = db.exec('SELECT * FROM photos WHERE id = ?', [result[0].values[0][0]]);
    const columns = newPhoto[0].columns;
    const row = newPhoto[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除照片
app.delete('/api/photos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM photos WHERE id = ?', [id]);
    if (check.length === 0 || check[0].values.length === 0) {
      return res.status(404).json({ error: '照片不存在' });
    }
    const photoUsername = check[0].values[0][0];
    if (photoUsername && photoUsername !== username) {
      return res.status(403).json({ error: '只能删除自己的照片' });
    }
    db.run('DELETE FROM photos WHERE id = ?', [id]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 食品评论 API ==========
app.get('/api/foods/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const comments = db.exec(`SELECT * FROM food_comments WHERE food_id = ? ORDER BY created_at ASC`, [id]);
    if (comments.length === 0) return res.json([]);
    const columns = comments[0].columns;
    const values = comments[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/foods/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const { username, content } = req.body;
    if (!username || !content) return res.status(400).json({ error: '请填写完整' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO food_comments (food_id, username, content, created_at) VALUES (?, ?, ?, ?)',
      [id, username, content, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newComment = db.exec('SELECT * FROM food_comments WHERE id = ?', [result[0].values[0][0]]);
    const columns = newComment[0].columns;
    const row = newComment[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/foods/:id/comments/:commentId', (req, res) => {
  try {
    const { commentId } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM food_comments WHERE id = ?', [commentId]);
    if (check.length === 0) return res.status(404).json({ error: '评论不存在' });
    if (check[0].values[0][0] !== username) return res.status(403).json({ error: '只能删除自己的评论' });
    db.run('DELETE FROM food_comments WHERE id = ?', [commentId]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 旅游评论 API ==========
app.get('/api/travels/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const comments = db.exec(`SELECT * FROM travel_comments WHERE travel_id = ? ORDER BY created_at ASC`, [id]);
    if (comments.length === 0) return res.json([]);
    const columns = comments[0].columns;
    const values = comments[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/travels/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const { username, content } = req.body;
    if (!username || !content) return res.status(400).json({ error: '请填写完整' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO travel_comments (travel_id, username, content, created_at) VALUES (?, ?, ?, ?)',
      [id, username, content, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newComment = db.exec('SELECT * FROM travel_comments WHERE id = ?', [result[0].values[0][0]]);
    const columns = newComment[0].columns;
    const row = newComment[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/travels/:id/comments/:commentId', (req, res) => {
  try {
    const { commentId } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM travel_comments WHERE id = ?', [commentId]);
    if (check.length === 0) return res.status(404).json({ error: '评论不存在' });
    if (check[0].values[0][0] !== username) return res.status(403).json({ error: '只能删除自己的评论' });
    db.run('DELETE FROM travel_comments WHERE id = ?', [commentId]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 目标评论 API ==========
app.get('/api/goals/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const comments = db.exec(`SELECT * FROM goal_comments WHERE goal_id = ? ORDER BY created_at ASC`, [id]);
    if (comments.length === 0) return res.json([]);
    const columns = comments[0].columns;
    const values = comments[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/goals/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const { username, content } = req.body;
    if (!username || !content) return res.status(400).json({ error: '请填写完整' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO goal_comments (goal_id, username, content, created_at) VALUES (?, ?, ?, ?)',
      [id, username, content, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newComment = db.exec('SELECT * FROM goal_comments WHERE id = ?', [result[0].values[0][0]]);
    const columns = newComment[0].columns;
    const row = newComment[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/goals/:id/comments/:commentId', (req, res) => {
  try {
    const { commentId } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM goal_comments WHERE id = ?', [commentId]);
    if (check.length === 0) return res.status(404).json({ error: '评论不存在' });
    if (check[0].values[0][0] !== username) return res.status(403).json({ error: '只能删除自己的评论' });
    db.run('DELETE FROM goal_comments WHERE id = ?', [commentId]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;

// ========== 日历事件 API ==========
app.get('/api/calendar/events', (req, res) => {
  try {
    const events = db.exec('SELECT * FROM calendar_events ORDER BY event_date ASC');
    if (events.length === 0) return res.json([]);
    const columns = events[0].columns;
    const values = events[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(values);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/calendar/events', (req, res) => {
  try {
    const { username, title, event_date, note, calendar_type, repeat_type, lunar_month, lunar_day } = req.body;
    if (!username || !title || !event_date) return res.status(400).json({ error: '请填写完整信息' });
    const createdAt = new Date().toISOString();
    db.run('INSERT INTO calendar_events (username, title, event_date, note, calendar_type, repeat_type, lunar_month, lunar_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [username, title, event_date, note || null, calendar_type || '公历', repeat_type || '不重复', lunar_month || null, lunar_day || null, createdAt]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const newEvent = db.exec('SELECT * FROM calendar_events WHERE id = ?', [result[0].values[0][0]]);
    const columns = newEvent[0].columns;
    const row = newEvent[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    saveDB();
    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/calendar/events/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    const check = db.exec('SELECT username FROM calendar_events WHERE id = ?', [id]);
    if (check.length === 0 || check[0].values.length === 0) {
      return res.status(404).json({ error: '事件不存在' });
    }
    // 允许空用户名或匹配的用户名删除
    if (username && check[0].values[0][0] !== username) {
      return res.status(403).json({ error: '只能删除自己的事件' });
    }
    db.run('DELETE FROM calendar_events WHERE id = ?', [id]);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`留言墙服务器已启动: http://localhost:${PORT}`);
    console.log(`局域网访问: http://${require('os').networkInterfaces()['以太网']?.[0]?.address || require('os').networkInterfaces()['WLAN']?.[0]?.address || '查看本机IP'}:${PORT}`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
