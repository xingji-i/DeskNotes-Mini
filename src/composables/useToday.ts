import { computed, onMounted, onUnmounted, ref } from "vue";
import { formatShortDate } from "../lib/date";

export function useToday() {
  const today = ref(new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const refresh = () => {
    clearTimeout(timer);
    today.value = new Date();
    const midnight = new Date(today.value);
    midnight.setHours(24, 0, 0, 0);
    timer = setTimeout(refresh, midnight.getTime() - today.value.getTime());
  };

  onMounted(() => {
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
  });
  onUnmounted(() => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  });

  return computed(() => formatShortDate(today.value));
}
