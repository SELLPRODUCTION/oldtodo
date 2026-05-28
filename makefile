CC = clang 
CFLAGS = -g -O0 -Wall -Wextra -I./src

SRC = $(shell find src -name "*.c")

all:
	$(CC) main.c $(SRC) $(CFLAGS) -o app

run:
	./app

clean:
	rm -f app
