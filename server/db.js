import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

export function getProjects() {
  if (!fs.existsSync(PROJECTS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

export function saveProjects(projects) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export function getProjectData(projectId) {
  const file = path.join(DATA_DIR, `project_${projectId}.json`);
  if (!fs.existsSync(file)) {
    return { pages: [], editorText: '', targetKeywords: 'seo, optimizare, site', googlePropertyId: '' };
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { pages: [], editorText: '', targetKeywords: 'seo, optimizare, site', googlePropertyId: '' };
  }
}

export function saveProjectData(projectId, data) {
  const file = path.join(DATA_DIR, `project_${projectId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function deleteProjectFiles(projectId) {
  const file = path.join(DATA_DIR, `project_${projectId}.json`);
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch (e) {
      console.error(`Error deleting file for project ${projectId}:`, e);
    }
  }
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');

export function getUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
      {
        id: 'usr_admin',
        name: 'Cristian Podina',
        username: 'cristianpodina',
        password: 'adminpassword123',
        role: 'admin',
        email: 'cristianpodina@gmail.com'
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

export function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
