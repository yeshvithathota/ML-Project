# Customer Lens — Customer Category Prediction

A React dashboard and FastAPI service for your multiclass customer-category project. The API trains a scikit-learn Logistic Regression pipeline on your CSV, reports a stratified 80/20 evaluation, and predicts a category with class probabilities. It has separate Admin and User sign-in screens. Signed-in Admins and Users can upload or replace the training CSV.

Visitors can create a User account from the sign-in screen. New accounts are stored in `data/accounts.sqlite3` with salted PBKDF2 password hashes; sign-up never grants Admin access. Admin access continues to use the credentials set in `.env`.

## Run locally in VS Code

### 1. Add your dataset

Create `data` in the project folder and place your dataset there as `customer_data.csv`. The target column must be named `customer_segment`. Keep `customer_id` if present; the API excludes it automatically. The app discovers the remaining feature names and types from your CSV. You can also sign in as Admin and upload the CSV from the site.

### 2. Configure the two accounts

In the VS Code terminal, copy the example environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and change `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `USER_USERNAME`, and `USER_PASSWORD` to your own values. Generate a private signing secret with:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the printed value into `APP_SECRET` in `.env`. Do not share or commit `.env`; it is in `.gitignore`. The Admin credentials can upload a dataset. The User credentials can view analytics and make predictions. Sessions expire after 24 hours.

### 3. Start the Python API

Use Python 3.12 for these pinned ML package versions. Check installed interpreters with `py -0p`.

Open a VS Code terminal in the project folder and run:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --reload
```

Leave this terminal running. If PowerShell blocks virtual-environment activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, then activate again. The API is at `http://127.0.0.1:8000`; its interactive API docs are at `http://127.0.0.1:8000/docs`.

### 4. Start the React site

Open a **second** VS Code terminal in the same folder:

```powershell
npm install
npm run dev
```

Open the Vite address printed in that terminal, usually `http://localhost:5173`. Choose the Admin or User tab and sign in with the credentials from `.env`, or create a User account. Choose **Upload CSV** or drag a CSV onto the highlighted upload area. The API saves it as `data/customer_data.csv` and trains the model. The site will then show live evaluation results and the prediction form.

If the API is stopped, sign-in and predictions will not work. Restart it with `uvicorn backend.main:app --reload` and leave that terminal open.

## Deploy online with Render

The project includes a `render.yaml` Blueprint for creating the frontend and API together. Push the project to a Git repository first, then connect that repository to Render and create a new Blueprint. Render will request the Admin username and password; enter fresh credentials there. It generates `APP_SECRET` and connects the frontend URL to the API's CORS setting. The generated frontend URL and API URL appear in the Render dashboard after deployment.

The free API service uses an ephemeral filesystem. Uploaded data and local sign-up accounts can be lost when the service restarts or redeploys. To retain them, attach a persistent disk mounted at `/opt/render/project/src/data`; Render currently offers persistent disks on paid services.

## Deploy online with Vercel + Render

The React frontend and Python API are separate services. You need to push this project to a Git repository that your hosting accounts can access. Never add `.env` or your customer CSV to a public repository.

### 1. Deploy the Python API to Render

1. In Render, create a **Web Service** connected to your repository.
2. Set the root directory to the repository root, build command to `pip install -r backend/requirements.txt`, and start command to `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`.
3. Add these environment variables in the Render service settings: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `USER_USERNAME`, `USER_PASSWORD`, and `APP_SECRET`. Use new, strong production passwords and generate a separate random `APP_SECRET` with `py -c "import secrets; print(secrets.token_urlsafe(48))"`. Also set `FRONTEND_ORIGIN` to the exact Vercel site origin once you have it (for example, `https://your-site.vercel.app`, no trailing slash).
4. Deploy. Your API URL will look like `https://your-api-name.onrender.com`. Its health check is `https://your-api-name.onrender.com/api/health`.

Render's default filesystem is ephemeral. For uploaded CSV files and registered accounts to survive restarts and deployments, attach a persistent disk to the API service, mount it at `/opt/render/project/src/data`, and set `DATA_DIR=/opt/render/project/src/data` in the service environment. Without persistent storage, files and sign-up accounts are lost on restart or redeploy. Render documents persistent disks as a paid-service feature; see its current plan and disk details before choosing this option.

### 2. Deploy the React frontend to Vercel

1. In Vercel, import the same repository and set the project root to the repository root.
2. Use the default Vite build settings: build command `npm run build`, output directory `dist`.
3. Add the build environment variable `VITE_API_URL` with your Render API origin, for example `https://your-api-name.onrender.com` (no `/api` suffix).
4. Deploy and copy your Vercel production origin. Go back to Render and set `FRONTEND_ORIGIN` to that exact origin, then redeploy the API.
5. Open the Vercel URL, sign in, and upload the CSV from the Admin account. Confirm the dashboard changes from “Model not trained” to “Model ready.”

`VITE_API_URL` is included in the browser bundle and is not a secret. Keep passwords and `APP_SECRET` only in the API host's environment settings. For production customer data, use HTTPS, restrict account access, and select storage appropriate for the data's sensitivity.

## Dataset and model details

The presentation describes 50,000 records, 14 columns, four customer categories, median imputation and scaling for numeric features, most-frequent imputation and one-hot encoding for categorical features, and weighted evaluation metrics. The app calculates live results from the CSV you supply; it does not invent data or predictions. Until training, the Method page shows the presentation's reference scores (66.4% accuracy and 0.656 weighted F1).
