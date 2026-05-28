// Headers
#include "src/ui/functions/menu/menu.h"
#include "src/common/context.h"

Context ctx = {0};

int main() {
    while (menu(&ctx) == 0);
    return 0;
}