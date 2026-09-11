# RECALLER

Project architecture overview:

```
RECALLER/
│
├── frontend/                  ← React/Vite public website
│   ├── public/
│   │   ├── images/
│   │   ├── videos/
│   │   └── downloads/
│   │
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── sections/
│   │   ├── animations/
│   │   ├── data/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   │
│   ├── package.json
│   └── vite.config.js
│
├── n8n-master/                ← completely isolated n8n source
│
├── docs/
│   └── ...
│
├── .gitignore
└── README.md
```
