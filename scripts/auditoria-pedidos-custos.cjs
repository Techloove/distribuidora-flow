// Regressão da divergência identificada na vistoria de 04/11/2026.
// A reprodução anterior mostrou custo 140 para snapshot 100; agora exige 100.
// Somente dados fictícios em banco PGlite descartável, sem conexão externa.
require("./check-custo-historico-database.cjs");
