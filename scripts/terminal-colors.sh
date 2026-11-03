#!/bin/sh
# Run inside the SSH terminal: sh scripts/terminal-colors.sh
printf 'TERM=%s COLORTERM=%s\n\n' "${TERM-}" "${COLORTERM-}"
printf 'ANSI 16 foreground\n'
i=0
while [ "$i" -lt 16 ]; do
  if [ "$i" -lt 8 ]; then code=$((30 + i)); else code=$((90 + i - 8)); fi
  printf '\033[%sm %02d TEXT \033[0m' "$code" "$i"
  i=$((i + 1))
  if [ $((i % 8)) -eq 0 ]; then printf '\n'; fi
done
printf '\nANSI 16 background\n'
i=0
while [ "$i" -lt 16 ]; do
  if [ "$i" -lt 8 ]; then code=$((40 + i)); else code=$((100 + i - 8)); fi
  printf '\033[%sm    \033[0m' "$code"
  i=$((i + 1))
done
printf '\n\n256-color background\n'
i=0
while [ "$i" -lt 256 ]; do
  printf '\033[48;5;%sm  \033[0m' "$i"
  i=$((i + 1))
  if [ $((i % 32)) -eq 0 ]; then printf '\n'; fi
done
printf '\nTrue Color RGB gradients\n'
for channel in red green blue; do
  i=0
  while [ "$i" -lt 64 ]; do
    value=$((i * 255 / 63))
    case "$channel" in
      red) r=$value; g=0; b=0 ;;
      green) r=0; g=$value; b=0 ;;
      blue) r=0; g=0; b=$value ;;
    esac
    printf '\033[48;2;%s;%s;%sm \033[0m' "$r" "$g" "$b"
    i=$((i + 1))
  done
  printf '\n'
done
printf '\033[38;2;255;128;64mTrue Color foreground\033[0m | default colors restored\n'
