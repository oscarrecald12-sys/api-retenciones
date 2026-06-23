package com.dutriec.apiretenciones;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration
public class DataSourceConfig {

    @Primary
    @Bean(name = "sqlAnywhereDataSource")
    public DataSource sqlAnywhereDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:sybase:Tds:190.128.241.46:49152/yml_dutriec");
        config.setUsername("costos");
        config.setPassword("costosdutriec");
        config.setDriverClassName("com.sybase.jdbc3.jdbc.SybDriver");
        config.setConnectionTestQuery("SELECT 1");
        config.setInitializationFailTimeout(-1);
        return new HikariDataSource(config);
    }

    /*version de entorno Nico, no sobreescribir */
    /*
    @Bean(name = "mariadbDataSource")
    public DataSource mariadbDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mariadb://localhost:3306/retenciones_sifen");
        config.setUsername("root");
        config.setPassword("dutriec26");
        config.setDriverClassName("org.mariadb.jdbc.Driver");
        return new HikariDataSource(config);
    }
    */

    //versión entorno Gabriel
    @Bean(name = "mariadbDataSource")
    public DataSource mariadbDataSource() {
        HikariConfig config = new HikariConfig();
        
        String url = "jdbc:mariadb://localhost:3306/retenciones_sifen" +
                    "?disabledAuthenticationPlugins=org.mariadb.jdbc.plugin.authentication.addon.gssapi.WindowsNativeSspiAuthentication" +
                    "&defaultAuthenticationPlugin=mysql_native_password";
        config.setJdbcUrl(url);
        config.setUsername("usuario_retenciones");
        config.setPassword("password_retenciones");
        config.setDriverClassName("org.mariadb.jdbc.Driver");
        return new HikariDataSource(config);
    }


    @Primary
    @Bean(name = "sqlAnywhereJdbcTemplate")
    public JdbcTemplate sqlAnywhereJdbcTemplate(
        @Qualifier("sqlAnywhereDataSource") DataSource ds) {
        return new JdbcTemplate(ds);
    }

    @Bean(name = "mariadbJdbcTemplate")
    public JdbcTemplate mariadbJdbcTemplate(
        @Qualifier("mariadbDataSource") DataSource ds) {
        return new JdbcTemplate(ds);
    }
}