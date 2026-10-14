<?php
/* LED Wall Planner on your own server: copy this file to config.php, in this same api folder,
   and fill it in (see NAS.md). config.php holds passwords: it shows nothing when opened in a
   browser, and it does not belong in the GitHub repository. */
return [
  // the planner's shared password: everyone signs in with it. Use a long one; changing it signs everyone out.
  'password' => 'change-this-to-a-long-password',

  // the MariaDB database made for the planner, and its own user (NAS.md, step 1).
  // Synology's MariaDB 10 listens on port 3307; your time tracking site's config.php uses the same host and port.
  'db_host' => '127.0.0.1',
  'db_port' => 3307,
  'db_name' => 'led_planner',
  'db_user' => 'led_planner',
  'db_pass' => 'the-password-of-the-led_planner-user',

  // which PHP database driver to use: 'auto' finds one (pdo_mysql, else mysqli); set 'pdo' or 'mysqli' only if needed
  'db_driver' => 'auto',
];
