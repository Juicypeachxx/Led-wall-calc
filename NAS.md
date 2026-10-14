# The planner on your Synology NAS

The planner can run on your own NAS, next to your other websites, and keep everything in your MariaDB database: projects, your panels and settings. Everyone who signs in with the planner's shared password sees the same projects, on any device. The planner page is the same `index.html` as on GitHub Pages. A small PHP program next to it, `api/index.php`, stores the data and asks for the password.

These steps put it at **https://stevecur.ddns.net/led/**, in its own folder beside the timebox site. Timebox and its database stay untouched. It takes about 15 minutes.

You need Web Station, MariaDB 10 and phpMyAdmin, which the timebox site already uses.

## 1. A database for the planner (phpMyAdmin)

1. Open phpMyAdmin (Web Station › Web Portal › phpMyAdmin) and sign in with the MariaDB account you normally use there.
2. Open **User accounts** › **Add user account** and fill in:
   - **User name:** `led_planner`
   - **Host name:** **Any host** (`%`). Timebox runs in a container (Container Manager lists it), so the planner reaches MariaDB from the container's network, not from `localhost`.
   - **Password:** click **Generate** and keep the password; you need it in step 3.
   - **Database for user account:** tick **Create database with same name and grant all privileges**.
   - Leave **Global privileges** empty, then click **Go**.

This makes the database `led_planner` and a user that can only use that database. The planner creates its tables there by itself the first time it runs (`led_projects`, `led_panels`, `led_docs`, `led_logins`).

## 2. The files (File Station)

1. On GitHub, open the planner's repository and click **Code › Download ZIP**, then unzip it on your computer.
2. In File Station, open the `web` folder (where timebox's files are) and create a folder named `led`.
3. Upload `index.html` from the unzipped folder into `web/led`.
4. Upload the folder `server/api` from the unzipped folder into `web/led`, so that `web/led/api/index.php` and `web/led/api/config.sample.php` exist.

## 3. The settings file

1. Download `web/led/api/config.sample.php`, open it in a plain text editor (Notepad, or TextEdit in plain-text mode), and save it as `config.php`.
2. Fill it in:
   - `password`: the planner's shared password, which everyone signs in with. Make it long, for example four random words.
   - `db_host` and `db_port`: copy them from timebox's `config.php` in the `web` folder. The planner reaches MariaDB the same way timebox does. Synology's MariaDB 10 listens on port 3307, and from a container the host is usually the NAS's own address, not `127.0.0.1`.
   - `db_name`: `led_planner`, `db_user`: `led_planner`, and `db_pass`: the password from step 1.
   - Leave `db_driver` at `'auto'`.
3. Upload `config.php` into `web/led/api`.

`config.php` holds passwords. It shows nothing when opened in a browser, and it must not go into the GitHub repository, which is public.

## 4. Open it

Go to **https://stevecur.ddns.net/led/**. The planner asks for the password. After you sign in, the line under the project name says **Saves on the server**. A sign-in lasts 30 days on that device.

If something is not right, the sign-in box (or that line, when clicked) says what:

| Message | What to do |
|---|---|
| config.php is missing | Step 3: `config.php` must be in `web/led/api`. |
| Set the shared password | Step 3: replace the sample password. |
| the user name or password is wrong, or this user may not connect from here | Check `db_user` and `db_pass`, and that the user's host is **Any host** (`%`). |
| no database server answers at that host and port | Copy `db_host` and `db_port` from timebox's `config.php`. |
| the database does not exist | Step 1: tick **Create database with same name**, or check `db_name`. |
| Turn on the PHP extension pdo_mysql (or mysqli) | The PHP of the timebox site needs one of the two. Timebox already uses MariaDB, so one is usually there; look under Web Station › Script Language Settings. |

If the address shows timebox instead of the planner, timebox's `.htaccess` in `web` may be sending every address to timebox. Send its contents to Claude and it can say what to change.

## Using it

- **Projects** saved in a browser before you signed in stay in that browser; **Open** marks them "this browser only". Open one and change anything, and from then on it is saved on the server.
- **Settings › Server** shows whether you are signed in, and signs out.
- After 10 wrong passwords from one address, signing in from there is locked for 15 minutes. Changing the password in `config.php` signs everyone out.
- The GitHub copy (https://juicypeachxx.github.io/Led-wall-calc/) keeps working as before, with projects in each browser.

## Updating

When the planner changes, upload the new `index.html` into `web/led`. Upload `server/api/index.php` into `web/led/api` too when the change list says the server changed. `config.php` stays as it is.

## Backups

The data lives in the MariaDB database `led_planner`. Back it up with phpMyAdmin (**Export**) or Hyper Backup, which can include MariaDB 10. The files are in `web/led`.
