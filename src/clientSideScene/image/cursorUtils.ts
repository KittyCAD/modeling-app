const cursorMap = {
  rotate: {
    datauri:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAFiUAABYlAUlSJPAAAAWLSURBVGhD7VndTxxVFJ9Zlo+yLK7r4oqogJIiq+2uIW2jqQZiQnioslpJTF8ECciHSfEPQGhsDPGhiC+YNAEMkRhDgBflDQjhhQRCCU0gIQQeUIkJX0r4kI/x97vMbYftUnHtDNvIL/nlzj1zd+ace88599xZ5RSnOMUpHn9ompYHluhdS2HT24gApV17e3tf43Jgf38/E+1/el4kiPiFUD4A3rHZbNfZ39rasqOJ4bWViMgAKE6lx1VVTT+QKMr29jYNiO4VgOIZ4AAu6TZKc3OzIAG5Ki6iFVCwFlwBtbm5OS0vL0+juKGhgSINK3B3c3PzJi6DYODgV1EAKCNmHRRob2/XXC6XUJ6UBoQBjW0Dg+JBJuGhy66/vA10ra6uKqWlpUpvb6+4JxEIBASJjIwMxe/3iz6vDZgHbyBm2g+6FgAu8T6nUUK6zHEJA7Ta2lrhbgawY8l+YUtJSUnCyxt2d3f/EG82+L2RVJRyEjN/yL0kS0pKDhmi7x3mAcowJT4Jnq2srHxvY2PjN/3dWn19/SHlwsXA+Pi41tbW9oDBxrHY+O7ALfkOU8D0mgQ+B54DX4dSrfq7xWxy5iG/pxSNXFtbmxEdAziWK8CxJH8nV4NGoHFB/uhRXFwc4/V6Hbj0gtmxsbEXysrKikNXQxpAA+12+2WMfbOuru7j4eHhb4xjuSLSvUKMGIRMBU0BHxwPcqkzYYQf7RvT09M/ircbMDU19S3unYuLi+OKvYaxl2hQX1/fl9IQ48oZjUBMfIYGYvNgZ1CjTQVzoNzFlpaWT40zvLCw0JSUlPQ07j+VmJjIccyjPvBCeXn5VTmW8SFXgjGiYwXx8CJkpq0EwbhIAN0gXxagYvPz8z9Tg6Wlpa8gOwPafT5fHNpE0J2QkMB66XxVVVVQGtHU1CQMILkxEsh236Fvei3FGWLF6QTTQM7wxaGhoc9nZ2evZ2Vl0d0kVD2bMY6egWv5Kioqgjs7O39SYZmh6EoSo6OjHv4ONB2cKc62Jz4+/iW02XQbfeZDoUJJrhzdyzc5OXmbyg4MDNxbhZ6eHmEANs8v0Dd9FQTwPs5ULJjsdDo5c0/o/XDgWBqRWlhYeFlujunp6cIAGQtYnSH0j3qGaYjJzc2N1d3lYcvPmaU7ZSL7fE+FmYLRF0G9siIKXa2jo4MJwBI3igQ00tPV1fURlTW6Ea+JxcXFD9E/thtZ42/3sQdudXd3T7Ajq1hiYkKIFAQ702/UGqAh0P/q7Oz8HXHwC1xHQRyIG0jHosUeQ8Gx9bLE1+AZtWhEzYPSQcWmdQab3jXMdlp+fr4yODiooF5SUG4oCOS7GN+Le1wtiXlLzxJGIFBt2MCuCgcPA7kfsOA7Cuvr629jTNhVMX0FmKGwyTmQeW7DZT7gyU5+CCCwEwv3YTwEg/dPnygURYugvpWamnoTz1kfGxvbhYgGWwca4HA4vEVFRZdw6P+VM8qTGm4dSZYaBMejnwN3S0Fr+f4gwdIjGcxqbW39RGgG8PQG2QOUmxpRXV39DnZ61l0sXaxOOIfA2eNu/crMzMwPVI6ltKxKJY0lNksOyHKSk5NZPHL/ODlAH8YaS4m0goKCt6QrGatSkoceQncdnj24KxsLxBOFzePxOFFeZzY2Nl4TmgKhWYjVKkrvdyHjx2IHsxh/HC2w6y7xsqxK6TKMB+k6IyMjt3A/B+S4EwvcsIB+Ks8M+onNv7y8PEalZSGHdPoT5aB0HUs22n8LugSPpxnMMvKAQ7+vqam5AvkL+seEqHKdUDCruJEis+kyNKC/v/8GZGfdbjdT7slmnX8C9FX10xs/2ZzXlX8V5KmN8qh0nVCoKBF48H+eK4H2WZCp9rFQXiJG/1zDjEO/t/wvqkcBKm2Ptnx/iv8JFOVvDRU31c9b/ScAAAAASUVORK5CYIJErkJggg==',
    originX: 12,
    originY: 12,
  },
}
const cursorCache = new Map<number, string>()

const TAU = Math.PI * 2

export function getRotateCursor(rotationRad: number): string {
  const rotateCursor = cursorMap.rotate
  const normalized = ((rotationRad % TAU) + TAU) % TAU
  const degrees = Math.round((normalized * 180) / Math.PI)
  const cached = cursorCache.get(degrees)
  if (cached) {
    return cached
  }
  const size = Math.max(rotateCursor.originX, rotateCursor.originY) * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${rotateCursor.originX} ${rotateCursor.originY}) rotate(${degrees}) translate(${-rotateCursor.originX} ${-rotateCursor.originY})"><image href="${rotateCursor.datauri}" width="${size}" height="${size}"/></g></svg>`
  const encoded = encodeURIComponent(svg)
  const cursor = `url("data:image/svg+xml;utf8,${encoded}") ${rotateCursor.originX} ${rotateCursor.originY}, grab`
  cursorCache.set(degrees, cursor)
  return cursor
}
