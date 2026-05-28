// Libraries
#include <time.h>

// Scripts
#include "core/variables/time.h"

DateTime dt;


DateTime getCurrentTime() {
    time_t now = time(NULL);
    struct tm *t = localtime(&now);

    DateTime dt;

    dt.year   = t->tm_year + 1900;
    dt.month  = t->tm_mon + 1;
    dt.day    = t->tm_mday;
    dt.hour   = t->tm_hour;
    dt.minute = t->tm_min;
    dt.second = t->tm_sec;

    return dt;
}