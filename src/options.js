// Form choices and course names. Single source of truth: served to the browser through /config.js
// and used by the server validator. Edit a list here and both sides follow.
const STATUSES = ['Student / Fresher', 'Working Professional'];
const STATUS_SUBTITLES = {
  'Student / Fresher': 'Currently studying or recently graduated',
  'Working Professional': 'Have work experience in any field'
};

// Student / Fresher branch
const STUDENT_COURSES = ['BCA', 'B.Sc CS / IT', 'B.Tech / BE', 'MCA', 'M.Sc / M.Tech', 'B.Com / BBA', 'Diploma', 'Other'];
const STUDENT_STATUSES = ['1st / 2nd year', '3rd year', 'Final year', 'Graduated (fresher)'];

const SPECIALIZATIONS = [
  'Computer Science', 'Information Technology', 'AI / Data Science', 'Electronics & Communication',
  'Electrical', 'Mechanical', 'Civil', 'Commerce / Business', 'Other'
];

// Working Professional branch
const EXPERIENCE = ['0-2 yrs', '2-5 yrs', '5-10 yrs', '10+ yrs'];
const QUALIFICATIONS = ['Diploma', "Bachelor's degree", "Master's degree", 'MBA', 'PhD', 'Other'];
const ROLES = [
  'Software Developer / Engineer',
  'Data Analyst / Scientist',
  'DevOps / Cloud Engineer',
  'Product Manager',
  'UI / UX Designer',
  'QA / Tester',
  'IT Support / SysAdmin',
  'Business Analyst',
  'Sales / Marketing',
  'Other'
];

// Master classes. These are only the built-in defaults (used before the database answers and in unit tests):
// the live list is the `courses` table, managed from the admin panel (src/courses.js keeps these objects in sync).
// Slug rules: lowercase letters and digits only, 2-60 chars. The link people open is COURSE_PATHS[slug] (hyphenated).
const COURSES = {
  datascience: 'Data Science',
  cybersecurity: 'Cyber Security',
  generativeai: 'Generative AI'
};
const COURSE_PATHS = { datascience: 'datascience', cybersecurity: 'cybersecurity', generativeai: 'generative-ai' };
const DEFAULT_SLUGS = ['datascience', 'cybersecurity', 'generativeai'];
const ALIASES = {
  cyber: 'cybersecurity',
  ds: 'datascience',
  datasciences: 'datascience',
  genai: 'generativeai',
  gen: 'generativeai',
  generative: 'generativeai'
};
// Words that are never a course (pages of this app)
const RESERVED = ['register', 'index', 'course', 'masterclass', 'admin', 'api', 'health', 'ready', 'config'];

module.exports = { SPECIALIZATIONS, QUALIFICATIONS, STATUSES, STATUS_SUBTITLES, STUDENT_COURSES, STUDENT_STATUSES, EXPERIENCE, ROLES, COURSES, COURSE_PATHS, DEFAULT_SLUGS, ALIASES, RESERVED };
