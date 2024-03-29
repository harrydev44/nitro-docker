#!/bin/bash

cd /var/www/orion-cms

cp /var/www/configuration/orion-cms/.env /var/www/orion-cms/.env

composer install
yarn install && yarn build

php artisan migrate --seed
chown -R www-data:www-data /var/www/orion-cms
cd /var/www/orion-cms
chmod -R 775 storage
chmod -R 775 bootstrap/cache

echo "PHP-FPM for Orion is ready <3"
php-fpm