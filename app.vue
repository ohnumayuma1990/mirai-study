<script setup lang="ts">
const { initAuthListener } = useFirebaseAuth()

onMounted(() => {
  initAuthListener()
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
