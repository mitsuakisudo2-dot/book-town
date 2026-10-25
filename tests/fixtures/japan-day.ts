/**
 * The database keeps days and weeks in Japan time (now() at time zone
 * 'Asia/Tokyo'): the same screen error on a day is one row, and a shop's
 * visitors are counted for last week, Monday to Sunday. A check that writes
 * and then reads the same day or week fails if Japan's midnight falls in
 * between, as it did when CI ran at 00:00 in Japan. Such a check calls this
 * first: near midnight, it waits until the new day has begun.
 */
export async function clearOfJapanMidnight(seconds = 120) {
  const DAY = 86_400_000;
  const left = DAY - ((Date.now() + 9 * 3_600_000) % DAY);
  if (left <= seconds * 1000)
    await new Promise((resolve) => setTimeout(resolve, left + 1000));
}
