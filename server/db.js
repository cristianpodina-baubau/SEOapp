import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists for JSON fallback
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GOOGLE_TOKENS_FILE = path.join(DATA_DIR, 'google_tokens.json');

// Initialize Pool if DATABASE_URL is provided in environment variables
let pool = null;
if (process.env.DATABASE_URL) {
  // Use connection pooling for database queries
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  console.log('[DB] PostgreSQL pool initialized successfully.');
} else {
  console.log('[DB] DATABASE_URL not set. Running in local JSON fallback mode.');
}

export const dbErrors = [];

/**
 * Initializes database tables if using PostgreSQL.
 */
export async function initDb() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL,
        email VARCHAR(100),
        allowed_projects TEXT
      )
    `);

    // Create projects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        domain VARCHAR(255) NOT NULL,
        created_at VARCHAR(50) NOT NULL,
        google_property_id VARCHAR(100)
      )
    `);

    // Create project_data table
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_data (
        project_id VARCHAR(50) PRIMARY KEY,
        pages TEXT NOT NULL,
        editor_text TEXT,
        target_keywords TEXT,
        google_property_id VARCHAR(100)
      )
    `);

    // Ensure todo_list and custom_tasks columns exist in live database
    await client.query('ALTER TABLE project_data ADD COLUMN IF NOT EXISTS todo_list TEXT');
    await client.query('ALTER TABLE project_data ADD COLUMN IF NOT EXISTS custom_tasks TEXT');

    // Create settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Seed default admin if users table is empty
    const res = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(res.rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO users (id, name, username, password, role, email, allowed_projects)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, ['usr_admin', 'Cristian Podina', 'cristianpodina', 'adminpassword123', 'admin', 'cristianpodina@gmail.com', '[]']);
      console.log('[DB] Seeded default administrator account.');
    }
  } catch (e) {
    console.error('[DB Init Error] Failed to initialize PostgreSQL schema:', e.message);
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------
// PROJECTS ACCESSORS
// -------------------------------------------------------------

export async function getProjects() {
  if (pool) {
    try {
      const res = await pool.query('SELECT id, name, domain, created_at as "createdAt", google_property_id as "googlePropertyId" FROM projects ORDER BY created_at DESC');
      return res.rows;
    } catch (e) {
      console.error('[DB getProjects Error]', e.message);
      return [];
    }
  }

  // JSON Fallback
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

export async function saveProjects(projects) {
  if (pool) {
    try {
      await pool.query('BEGIN');
      await pool.query('DELETE FROM projects');
      for (const p of projects) {
        await pool.query(`
          INSERT INTO projects (id, name, domain, created_at, google_property_id)
          VALUES ($1, $2, $3, $4, $5)
        `, [p.id, p.name, p.domain, p.createdAt, p.googlePropertyId || '']);
      }
      await pool.query('COMMIT');
      return;
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error('[DB saveProjects Error]', e.message);
      return;
    }
  }

  // JSON Fallback
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// -------------------------------------------------------------
// PROJECT DATA ACCESSORS
// -------------------------------------------------------------

export async function getProjectData(projectId) {
  if (pool) {
    try {
      const res = await pool.query('SELECT pages, editor_text as "editorText", target_keywords as "targetKeywords", google_property_id as "googlePropertyId", todo_list as "todoList", custom_tasks as "customTasks" FROM project_data WHERE project_id = $1', [projectId]);
      if (res.rows.length === 0) {
        return { pages: [], editorText: '', targetKeywords: 'seo, optimizare, site', googlePropertyId: '', todoList: [], customTasks: [] };
      }
      const row = res.rows[0];
      return {
        pages: JSON.parse(row.pages),
        editorText: row.editorText || '',
        targetKeywords: row.targetKeywords || 'seo, optimizare, site',
        googlePropertyId: row.googlePropertyId || '',
        todoList: JSON.parse(row.todoList || '[]'),
        customTasks: JSON.parse(row.customTasks || '[]')
      };
    } catch (e) {
      console.error('[DB getProjectData Error]', e.message);
      return { pages: [], editorText: '', targetKeywords: 'seo, optimizare, site', googlePropertyId: '', todoList: [], customTasks: [] };
    }
  }

  // JSON Fallback
  const filePath = path.join(DATA_DIR, `project_${projectId}.json`);
  if (!fs.existsSync(filePath)) {
    return { pages: [], editorText: '', targetKeywords: 'seo, optimizare, site', googlePropertyId: '', todoList: [], customTasks: [] };
  }
  try {
    const fallbackData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      pages: fallbackData.pages || [],
      editorText: fallbackData.editorText || '',
      targetKeywords: fallbackData.targetKeywords || 'seo, optimizare, site',
      googlePropertyId: fallbackData.googlePropertyId || '',
      todoList: fallbackData.todoList || [],
      customTasks: fallbackData.customTasks || []
    };
  } catch (e) {
    return { pages: [], editorText: '', targetKeywords: 'seo, optimizare, site', googlePropertyId: '', todoList: [], customTasks: [] };
  }
}

export async function saveProjectData(projectId, data) {
  if (pool) {
    try {
      const pagesStr = JSON.stringify(data.pages || []);
      const todoListStr = JSON.stringify(data.todoList || []);
      const customTasksStr = JSON.stringify(data.customTasks || []);
      await pool.query(`
        INSERT INTO project_data (project_id, pages, editor_text, target_keywords, google_property_id, todo_list, custom_tasks)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (project_id) DO UPDATE 
        SET pages = EXCLUDED.pages, 
            editor_text = EXCLUDED.editor_text, 
            target_keywords = EXCLUDED.target_keywords, 
            google_property_id = EXCLUDED.google_property_id,
            todo_list = EXCLUDED.todo_list,
            custom_tasks = EXCLUDED.custom_tasks
      `, [projectId, pagesStr, data.editorText || '', data.targetKeywords || 'seo, optimizare, site', data.googlePropertyId || '', todoListStr, customTasksStr]);
      return;
    } catch (e) {
      console.error('[DB saveProjectData Error]', e.message);
      return;
    }
  }

  // JSON Fallback
  const filePath = path.join(DATA_DIR, `project_${projectId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export async function deleteProjectFiles(projectId) {
  if (pool) {
    try {
      await pool.query('DELETE FROM project_data WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
      return;
    } catch (e) {
      console.error('[DB deleteProject Error]', e.message);
      return;
    }
  }

  // JSON Fallback
  const dataPath = path.join(DATA_DIR, `project_${projectId}.json`);
  if (fs.existsSync(dataPath)) {
    fs.unlinkSync(dataPath);
  }
}

// -------------------------------------------------------------
// USERS ACCESSORS
// -------------------------------------------------------------

export async function getUsers() {
  if (pool) {
    try {
      const res = await pool.query('SELECT id, name, username, password, role, email, allowed_projects as "allowedProjects" FROM users');
      return res.rows.map(row => ({
        ...row,
        allowedProjects: JSON.parse(row.allowedProjects || '[]')
      }));
    } catch (e) {
      console.error('[DB getUsers Error]', e.message);
      return [];
    }
  }

  // JSON Fallback
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
      {
        id: 'usr_admin',
        name: 'Cristian Podina',
        username: 'cristianpodina',
        password: 'adminpassword123',
        role: 'admin',
        email: 'cristianpodina@gmail.com',
        allowedProjects: []
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    return defaultUsers;
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

export async function saveUsers(users) {
  if (pool) {
    try {
      await pool.query('BEGIN');
      await pool.query('DELETE FROM users');
      for (const u of users) {
        const allowedProjectsStr = JSON.stringify(u.allowedProjects || []);
        await pool.query(`
          INSERT INTO users (id, name, username, password, role, email, allowed_projects)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [u.id, u.name, u.username, u.password, u.role, u.email || '', allowedProjectsStr]);
      }
      await pool.query('COMMIT');
      return;
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error('[DB saveUsers Error]', e.message);
      return;
    }
  }

  // JSON Fallback
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// -------------------------------------------------------------
// GOOGLE TOKENS ACCESSORS
// -------------------------------------------------------------

export async function getAdminTokens() {
  if (pool) {
    try {
      const res = await pool.query("SELECT value FROM settings WHERE key = 'google_tokens'");
      if (res.rows.length === 0) return null;
      return JSON.parse(res.rows[0].value);
    } catch (e) {
      console.error('[DB getAdminTokens Error]', e.message);
      return null;
    }
  }

  // JSON Fallback
  if (!fs.existsSync(GOOGLE_TOKENS_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(GOOGLE_TOKENS_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

export async function saveAdminTokens(tokens) {
  if (pool) {
    try {
      const valStr = JSON.stringify(tokens);
      await pool.query(`
        INSERT INTO settings (key, value)
        VALUES ('google_tokens', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [valStr]);
      return;
    } catch (e) {
      console.error('[DB saveAdminTokens Error]', e.message);
      return;
    }
  }

  // JSON Fallback
  fs.writeFileSync(GOOGLE_TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export async function getDbColumns(tableName) {
  if (pool) {
    try {
      const res = await pool.query(`
        SELECT column_name, data_type, character_maximum_length 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [tableName]);
      return res.rows;
    } catch (e) {
      return { error: e.message };
    }
  }
  return { error: 'Database pool not initialized.' };
}
