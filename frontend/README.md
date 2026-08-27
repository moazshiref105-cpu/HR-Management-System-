# Local development

The browser app calls the SetUp API at the same origin (`/api`). Vite proxies this path in development; production should serve the static build and PHP API from the same host.

With the required server environment already available in your shell, start PHP first:

```sh
php -S 127.0.0.1:8081 -t ../backend/public
```

Then start Vite with its development-only proxy target:

```sh
HMS_PHP_API_ORIGIN=http://127.0.0.1:8081 npm run dev
```

Browser authentication requires only the safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values described in `.env.example`. Never place the Supabase secret key in frontend configuration.
