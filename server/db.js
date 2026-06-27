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
