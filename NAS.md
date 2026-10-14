# The planner on your Synology NAS

The planner can run on your own NAS, next to your other websites, and keep everything in your MariaDB database: projects, your panels and settings. Everyone who signs in with the planner's shared password sees the same projects, on any device. The planner page is the same `index.html` as on GitHub Pages. A small PHP program next to it, `api/index.php`, stores the data and asks for the password.

These steps put it at **https://stevecur.ddns.net/led/**, in its own folder beside the timebox site. Timebox and its database stay untouched. You need Web Station, MariaDB 10 and phpMyAdmin, which the timebox site already uses.

Steps 1 and 2 work from anywhere, through QuickConnect. Step 3, the database, needs phpMyAdmin, which only opens on your home network, or the Task Scheduler alternative at the end of step 3.

## 1. The files (File Station)

1. Get **led-for-nas.zip** (Claude can send it). It holds one folder, `led`.
2. In File Station, open the `web` folder (where timebox's files are), click **Upload › Upload - Skip** and choose the zip.
3. Right-click the zip › **Extract › Extract here**, then delete the zip. You now have:
   - `web/led/index.html`
   - `web/led/api/index.php`
   - `web/led/api/config.php`

Without the zip, take the files from the planner's repository on GitHub (**Code › Download ZIP**): `index.html` goes into `web/led`, and `server/api/index.php` and `server/api/config.sample.php` into `web/led/api`, where you rename `config.sample.php` to `config.php`.

## 2. The settings file

1. Find out how timebox connects to MariaDB. In `web`, right-click timebox's `config.php` › **Open with › Text Editor** (if that's missing, install Text Editor in Package Center, or download the file and open it in Notepad). Look for the database host and port (often port 3307), or a socket path ending in `.sock`. Don't change anything there.
2. Open `web/led/api/config.php` the same way and fill it in:
   - `password`: the planner's shared password, which everyone signs in with. Make it long, for example four random words joined by dashes.
   - `db_host` and `db_port`: the same as in timebox's `config.php`. If timebox uses a socket path instead, put that path in `db_socket`. The planner has to reach MariaDB the same way timebox does, because timebox runs in a container.
   - `db_name`: `led_planner`, `db_user`: `led_planner`, and `db_pass`: a new password for that database user. You need it again in step 3.
   - Leave `db_driver` at `'auto'`.

   Use only letters, numbers and dashes in both passwords. A `'` or `\` would break the file, and the command in step 3.
3. Save it. If you edited a downloaded copy, upload it back into `web/led/api` and replace the old one.

`config.php` holds passwords. It shows nothing when opened in a browser, and it must not go into the GitHub repository, which is public.

You can test this much already: open **https://stevecur.ddns.net/led/** and sign in with the shared password. Until step 3 is done, it says that it could not connect to the database:

- "the user name or password is wrong" (or "lets no user connect from this address"): good, the planner reached MariaDB. Step 3 makes the user.
- "no database server answers": the host and port (or socket) are not the ones timebox uses.
- anything else: see the table under step 4.

## 3. A database for the planner

### In phpMyAdmin (on your home network)

1. Open phpMyAdmin (Web Station › Web Portal › phpMyAdmin) and sign in with the MariaDB account you normally use there.
2. Open **User accounts** › **Add user account** and fill in:
   - **User name:** `led_planner`
   - **Host name:** **Any host** (`%`). Timebox runs in a container, so the planner reaches MariaDB from the container's network, not from `localhost`.
   - **Password:** the `db_pass` from step 2.
   - **Database for user account:** tick **Create database with same name and grant all privileges**.
   - Leave **Global privileges** empty, then click **Go**.

### Or with Task Scheduler (works through QuickConnect)

If you know the password of MariaDB's `root` account, DSM can run the same commands once:

1. **Control Panel › Task Scheduler › Create › Scheduled Task › User-defined script**.
2. **General:** name it `led planner database`, user **root**, and untick **Enabled** (it only runs when you click Run).
3. **Task Settings**, **Run command**, paste this as one line. Replace `ROOT-PASSWORD` with MariaDB's root password and `DB-PASSWORD` with the `db_pass` from step 2:

   ```
   /usr/local/mariadb10/bin/mysql -u root -p'ROOT-PASSWORD' -S /run/mysqld/mysqld10.sock -e "CREATE DATABASE IF NOT EXISTS led_planner CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'led_planner'@'%' IDENTIFIED BY 'DB-PASSWORD'; GRANT ALL PRIVILEGES ON led_planner.* TO 'led_planner'@'%'; FLUSH PRIVILEGES;" > /volume1/Data/led-setup.txt 2>&1; echo "finished: $?" >> /volume1/Data/led-setup.txt
   ```

4. Click **OK**, select the task and click **Run**.
5. In File Station, open `Data/led-setup.txt`. `finished: 0` means it worked. Anything else is MariaDB's error message (for example "Access denied" when the root password is wrong).
6. **Delete the task** afterwards, because it holds the root password, and delete `led-setup.txt`.

Either way, you get the database `led_planner` and a user that can only use that database. The planner creates its tables there by itself the first time it runs (`led_projects`, `led_panels`, `led_docs`, `led_logins`).

## 4. Open it

Go to **https://stevecur.ddns.net/led/** and sign in with the shared password. The line under the project name now talks about the server, for example **Saved on the server**. A sign-in lasts 30 days on that device.

If something is not right, the sign-in box (or that line, when clicked) says what:

| Message | What to do |
|---|---|
| config.php is missing | Step 2: `config.php` must be in `web/led/api`. |
| Set the shared password | Step 2: replace the sample password. |
| the user name or password is wrong, or this user may not connect from here | Check `db_user` and `db_pass`, and that the user's host is **Any host** (`%`). |
| MariaDB lets no user connect from this address | The user's host must be **Any host** (`%`) (step 3). |
| no database server answers at that host and port, or socket | Use the same host and port (or socket) as timebox's `config.php`. |
| the database does not exist | Step 3 is not done yet, or `db_name` is different. |
| Turn on the PHP extension pdo_mysql (or mysqli) | The PHP of the timebox site needs one of the two. Timebox already uses MariaDB, so one is usually there. |

If the address shows timebox instead of the planner, try **https://stevecur.ddns.net/led/index.html**. If that opens the planner, timebox's `.htaccess` in `web` sends folder addresses to timebox: use that address, or send the `.htaccess` contents to Claude, which can say what to change.

## Using it

- **Projects** saved in a browser before you signed in stay in that browser; **Open** marks them "this browser only". Open one and change anything, and from then on it is saved on the server.
- **Settings › Server** shows whether you are signed in, and signs out.
- After 10 wrong passwords from one address, signing in from there is locked for 15 minutes. Changing the password in `config.php` signs everyone out.
- Files you put into `web/led` can be opened by anyone who knows the address. Keep private lists out of there; the planner's data is in the database, behind the password.
- The GitHub copy (https://juicypeachxx.github.io/Led-wall-calc/) keeps working as before, with projects in each browser.

## Updating

When the planner changes, upload the new `index.html` into `web/led` and replace the old one. Upload `server/api/index.php` into `web/led/api` too when the change list says the server changed. Don't extract led-for-nas.zip over an installed planner: it would replace your `config.php` with an empty one.

## Backups

The data lives in the MariaDB database `led_planner`. Back it up with phpMyAdmin (**Export**) or Hyper Backup, which can include MariaDB 10. The files are in `web/led`.
